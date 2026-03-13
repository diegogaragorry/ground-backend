import { BillingPlanCode, BillingProvider, BillingSubscriptionStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getBillingConfig } from "./billing.service";
import {
  createRecurringPayment,
  extractCardLastFour,
  extractNetworkPaymentReference,
  extractPaymentId,
  extractPaymentStatus,
  extractProviderCardId,
  extractProviderCustomerId,
  extractProviderPaymentMethodId,
} from "./dlocal.service";

type RenewalRunResult = {
  claimed: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

type ClaimedRenewalRow = { id: string };

async function claimDueRenewalIds(limit: number) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedRenewalRow[]>(Prisma.sql`
      SELECT id
      FROM "BillingSubscription"
      WHERE "provider" = ${BillingProvider.DLOCAL}::"BillingProvider"
        AND "planCode" = ${BillingPlanCode.PRO_MONTHLY}::"BillingPlanCode"
        AND "status" = ${BillingSubscriptionStatus.ACTIVE}::"BillingSubscriptionStatus"
        AND "cancelAtPeriodEnd" = false
        AND "currentPeriodEndsAt" IS NOT NULL
        AND "currentPeriodEndsAt" <= NOW()
        AND "providerCardId" IS NOT NULL
        AND ("renewalLockedAt" IS NULL OR "renewalLockedAt" < NOW() - INTERVAL '30 minutes')
      ORDER BY "currentPeriodEndsAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);

    if (!rows.length) return [];

    const ids = rows.map((row) => row.id);
    await tx.billingSubscription.updateMany({
      where: { id: { in: ids } },
      data: { renewalLockedAt: new Date() },
    });
    return ids;
  });
}

async function releaseRenewalLock(subscriptionId: string) {
  await prisma.billingSubscription.update({
    where: { id: subscriptionId },
    data: { renewalLockedAt: null },
  });
}

async function markRenewalFailed(subscriptionId: string, userId: string, message: string, metadata?: Record<string, unknown>) {
  const config = getBillingConfig();
  const now = new Date();
  await prisma.billingSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: BillingSubscriptionStatus.PAST_DUE,
      graceEndsAt: addDays(now, config.graceDays),
      renewalLockedAt: null,
      metadata: {
        ...(metadata ?? {}),
        lastRenewalError: message,
        lastRenewalFailedAt: now.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.billingEvent.create({
    data: {
      userId,
      billingSubscriptionId: subscriptionId,
      provider: BillingProvider.DLOCAL,
      eventType: "dlocal_renewal_failed_local",
      payload: { message },
      processedAt: now,
    },
  });
}

export async function runDueMonthlyRenewals(limit = 10): Promise<RenewalRunResult> {
  const claimedIds = await claimDueRenewalIds(Math.max(limit, 1));
  const result: RenewalRunResult = {
    claimed: claimedIds.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const subscriptionId of claimedIds) {
    const subscription = await prisma.billingSubscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        userId: true,
        planCode: true,
        status: true,
        amountMinor: true,
        currencyCode: true,
        providerCardId: true,
        currentPeriodEndsAt: true,
        metadata: true,
        user: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            country: true,
          },
        },
      },
    });

    if (!subscription || !subscription.providerCardId || !subscription.user.country) {
      result.skipped += 1;
      if (subscription) {
        await releaseRenewalLock(subscription.id);
      }
      continue;
    }

    result.processed += 1;
    const metadata =
      subscription.metadata && typeof subscription.metadata === "object"
        ? (subscription.metadata as Record<string, unknown>)
        : {};
    try {
      const fullName =
        [String(subscription.user.firstName ?? "").trim(), String(subscription.user.lastName ?? "").trim()]
          .filter(Boolean)
          .join(" ") || subscription.user.email;
      const payment = await createRecurringPayment({
        amount: subscription.amountMinor / 100,
        currency: "USD",
        country: String(subscription.user.country).trim().toUpperCase(),
        orderId: `ground-renewal-${subscription.id}-${Date.now()}`,
        description: "Ground Pro monthly renewal",
        notificationUrl: `${String(process.env.BACKEND_PUBLIC_URL ?? "https://ground-backend-production.up.railway.app").replace(/\/+$/, "")}/billing/dlocal/notifications`,
        payer: {
          name: fullName,
          email: subscription.user.email,
          userReference: subscription.userId,
        },
        cardId: subscription.providerCardId,
        networkPaymentReference: String(metadata.networkPaymentReference ?? "").trim() || null,
      });

      const paymentId = extractPaymentId(payment);
      if (!paymentId) {
        throw new Error("dLocal recurring payment did not return payment id");
      }

      await prisma.billingEvent.create({
        data: {
          userId: subscription.userId,
          billingSubscriptionId: subscription.id,
          provider: BillingProvider.DLOCAL,
          eventType: "dlocal_renewal_started",
          externalId: paymentId,
          payload: payment as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });

      const normalizedStatus = extractPaymentStatus(payment);
      if (["PAID", "APPROVED", "AUTHORIZED", "COMPLETED"].includes(normalizedStatus)) {
        const nextPeriodStart = subscription.currentPeriodEndsAt ?? new Date();
        const nextPeriodEnd = new Date(nextPeriodStart);
        nextPeriodEnd.setUTCMonth(nextPeriodEnd.getUTCMonth() + 1);
        await prisma.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingSubscriptionStatus.ACTIVE,
            currentPeriodStartedAt: nextPeriodStart,
            currentPeriodEndsAt: nextPeriodEnd,
            graceEndsAt: null,
            renewalLockedAt: null,
            providerCustomerId: extractProviderCustomerId(payment) || undefined,
            providerPaymentMethodId: extractProviderPaymentMethodId(payment) || undefined,
            providerCardId: extractProviderCardId(payment) || subscription.providerCardId,
            metadata: {
              ...metadata,
              cardLast4: extractCardLastFour(payment) || metadata.cardLast4 || null,
              networkPaymentReference: extractNetworkPaymentReference(payment) || metadata.networkPaymentReference || null,
              lastRenewalPaidAt: new Date().toISOString(),
              lastRenewalPaymentId: paymentId,
              lastAppliedPaymentId: paymentId,
              lastDlocalStatus: normalizedStatus,
              lastDlocalSource: "renewal",
              lastDlocalPayload: payment,
            } as Prisma.InputJsonValue,
          },
        });
        await prisma.billingEvent.create({
          data: {
            userId: subscription.userId,
            billingSubscriptionId: subscription.id,
            provider: BillingProvider.DLOCAL,
            eventType: "dlocal_renewal_paid",
            externalId: paymentId,
            payload: payment as Prisma.InputJsonValue,
            processedAt: new Date(),
          },
        });
        result.succeeded += 1;
      } else if (["PENDING", "VERIFIED", "IN_PROCESS", "PROCESSING", "CREATED"].includes(normalizedStatus)) {
        await prisma.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingSubscriptionStatus.INCOMPLETE,
            renewalLockedAt: null,
          },
        });
        result.succeeded += 1;
      } else {
        throw new Error(`Recurring payment returned ${normalizedStatus || "unknown"}`);
      }
    } catch (error) {
      result.failed += 1;
      await markRenewalFailed(subscription.id, subscription.userId, error instanceof Error ? error.message : "renewal-failed", metadata);
    }
  }

  return result;
}
