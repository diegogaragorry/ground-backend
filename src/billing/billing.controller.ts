import { BillingPlanCode, BillingProvider, BillingSubscriptionStatus, UserRole } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { buildBillingSummary, getBillingConfig, getPlanDurationMonths, pickCurrentSubscription } from "./billing.service";
import {
  createSavedCard,
  createSubscriptionPayment,
  createRedirectPayment,
  deleteSavedCard,
  extractCardLastFour,
  extractNetworkPaymentReference,
  extractOrderId,
  extractPaymentId,
  extractPaymentStatus,
  extractProviderCardId,
  extractProviderCustomerId,
  extractProviderPaymentMethodId,
  extractRedirectUrl,
  getDLocalConfig,
  getPaymentStatus,
  verifyCallbackSignature,
  verifyNotificationSignature,
} from "./dlocal.service";
import { runDueMonthlyRenewals } from "./renewals.service";

const billingUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  country: true,
  role: true,
  createdAt: true,
  billingSubscriptions: {
    orderBy: { createdAt: "desc" as const },
    take: 10,
    select: {
      id: true,
      provider: true,
      planCode: true,
      status: true,
      currencyCode: true,
      amountMinor: true,
      trialStartedAt: true,
      trialEndsAt: true,
      currentPeriodStartedAt: true,
      currentPeriodEndsAt: true,
      graceEndsAt: true,
      cancelAtPeriodEnd: true,
      canceledAt: true,
      endedAt: true,
      providerCustomerId: true,
      providerSubscriptionId: true,
      providerPaymentMethodId: true,
      providerCardId: true,
      renewalLockedAt: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  },
};

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeCountryCode(raw: string | null | undefined) {
  const value = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : "";
}

async function loadBillingUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: billingUserSelect,
  });
}

async function loadPaymentRecord(paymentId: string) {
  const paymentEvent = await prisma.billingEvent.findFirst({
    where: {
      provider: BillingProvider.DLOCAL,
      externalId: paymentId,
      billingSubscriptionId: { not: null },
    },
    orderBy: { createdAt: "desc" },
  });

  if (paymentEvent?.billingSubscriptionId) {
    const subscription = await prisma.billingSubscription.findUnique({
      where: { id: paymentEvent.billingSubscriptionId },
    });
    if (subscription) {
      return {
        subscription,
        paymentEvent,
      };
    }
  }

  const subscription = await prisma.billingSubscription.findFirst({
    where: {
      provider: BillingProvider.DLOCAL,
      providerSubscriptionId: paymentId,
    },
    orderBy: { createdAt: "desc" },
  });

  return {
    subscription,
    paymentEvent,
  };
}

async function persistPaymentStatus(paymentId: string, payload: any, source: "callback" | "notification" | "subscribe") {
  const paymentStatus = extractPaymentStatus(payload);
  const { subscription: paymentRecord, paymentEvent } = await loadPaymentRecord(paymentId);

  if (!paymentRecord) {
    return { paymentStatus, billingSubscriptionId: null as string | null };
  }

  const config = getBillingConfig();
  const now = new Date();
  let nextStatus: BillingSubscriptionStatus;
  let periodEndsAt: Date | null = null;
  let endedAt: Date | null = null;
  let graceEndsAt: Date | null = null;
  const providerCardId = extractProviderCardId(payload) || paymentRecord.providerCardId;
  const providerPaymentMethodId = extractProviderPaymentMethodId(payload) || paymentRecord.providerPaymentMethodId;
  const providerCustomerId = extractProviderCustomerId(payload) || paymentRecord.providerCustomerId;
  const metadata =
    paymentRecord.metadata && typeof paymentRecord.metadata === "object"
      ? (paymentRecord.metadata as Record<string, unknown>)
      : {};
  const isRenewalPayment = paymentEvent?.eventType === "dlocal_renewal_started";
  const activePeriodStart =
    isRenewalPayment && paymentRecord.currentPeriodEndsAt ? paymentRecord.currentPeriodEndsAt : now;
  const normalizedStatus = paymentStatus || "UNKNOWN";
  const alreadyApplied = String(metadata.lastAppliedPaymentId ?? "") === paymentId;

  if (alreadyApplied && ["APPROVED", "PAID", "AUTHORIZED", "COMPLETED"].includes(normalizedStatus)) {
    await prisma.billingEvent.create({
      data: {
        userId: paymentRecord.userId,
        billingSubscriptionId: paymentRecord.id,
        provider: BillingProvider.DLOCAL,
        eventType: `dlocal_${source}_${normalizedStatus.toLowerCase() || "unknown"}`,
        externalId: paymentId,
        payload,
        processedAt: new Date(),
      },
    });
    return { paymentStatus: normalizedStatus, billingSubscriptionId: paymentRecord.id };
  }

  switch (normalizedStatus) {
    case "APPROVED":
    case "PAID":
    case "AUTHORIZED":
    case "COMPLETED":
      nextStatus = BillingSubscriptionStatus.ACTIVE;
      periodEndsAt = addMonths(activePeriodStart, Math.max(getPlanDurationMonths(paymentRecord.planCode), 1));
      break;
    case "PENDING":
    case "CREATED":
    case "IN_PROCESS":
    case "PROCESSING":
    case "VERIFIED":
      nextStatus = BillingSubscriptionStatus.INCOMPLETE;
      break;
    case "FAILED":
    case "EXPIRED":
    case "DECLINED":
      nextStatus =
        paymentRecord.status === BillingSubscriptionStatus.ACTIVE || isRenewalPayment
          ? BillingSubscriptionStatus.PAST_DUE
          : BillingSubscriptionStatus.INCOMPLETE;
      graceEndsAt = nextStatus === BillingSubscriptionStatus.PAST_DUE ? addDays(now, config.graceDays) : paymentRecord.graceEndsAt;
      break;
    case "CANCELLED":
    case "CANCELED":
    case "REJECTED":
      nextStatus = BillingSubscriptionStatus.CANCELED;
      endedAt = now;
      break;
    default:
      nextStatus = BillingSubscriptionStatus.INCOMPLETE;
      break;
  }

  const updated = await prisma.billingSubscription.update({
    where: { id: paymentRecord.id },
    data: {
      status: nextStatus,
      currentPeriodStartedAt: nextStatus === BillingSubscriptionStatus.ACTIVE ? activePeriodStart : paymentRecord.currentPeriodStartedAt,
      currentPeriodEndsAt: nextStatus === BillingSubscriptionStatus.ACTIVE ? periodEndsAt : paymentRecord.currentPeriodEndsAt,
      endedAt,
      graceEndsAt: graceEndsAt ?? paymentRecord.graceEndsAt,
      providerCardId,
      providerPaymentMethodId,
      providerCustomerId,
      renewalLockedAt: null,
      metadata: {
        ...metadata,
        lastDlocalPayload: payload,
        lastDlocalSource: source,
        lastDlocalStatus: normalizedStatus,
        lastDlocalOrderId: extractOrderId(payload) || metadata.orderId,
        lastDlocalCardId: providerCardId,
        lastDlocalPaymentMethodId: providerPaymentMethodId,
        networkPaymentReference: extractNetworkPaymentReference(payload) || metadata.networkPaymentReference || null,
        cardLast4: extractCardLastFour(payload) || metadata.cardLast4 || null,
        lastAppliedPaymentId:
          nextStatus === BillingSubscriptionStatus.ACTIVE ? paymentId : metadata.lastAppliedPaymentId || null,
        graceDays: config.graceDays,
      } as any,
    },
  });

  await prisma.billingEvent.create({
    data: {
      userId: paymentRecord.userId,
      billingSubscriptionId: updated.id,
      provider: BillingProvider.DLOCAL,
      eventType: `dlocal_${source}_${normalizedStatus.toLowerCase() || "unknown"}`,
      externalId: paymentId,
      payload,
      processedAt: new Date(),
    },
  });

  return { paymentStatus: normalizedStatus, billingSubscriptionId: updated.id };
}

export const getBillingSummary = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json(buildBillingSummary(user));
};

export const subscribeMonthlyPlan = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const summary = buildBillingSummary(user);
  if (summary.isSuperAdminBypass) {
    return res.status(400).json({ error: "Super admin accounts are excluded from billing" });
  }

  const currentSubscription = pickCurrentSubscription(user.billingSubscriptions as any);
  if (
    currentSubscription &&
    currentSubscription.planCode === BillingPlanCode.PRO_MONTHLY &&
    currentSubscription.status === BillingSubscriptionStatus.ACTIVE &&
    !currentSubscription.cancelAtPeriodEnd
  ) {
    return res.status(409).json({ error: "There is already an active monthly subscription" });
  }

  const requestedPlanCode = String(req.body?.planCode ?? "").trim().toUpperCase() as BillingPlanCode;
  if (requestedPlanCode !== BillingPlanCode.PRO_MONTHLY) {
    return res.status(409).json({ error: "Only monthly Pro subscription uses recurring setup" });
  }

  const cardToken = String(req.body?.cardToken ?? "").trim();
  if (!cardToken) {
    return res.status(400).json({ error: "Card token is required" });
  }

  const selectedOffer = summary.offers.find((offer) => offer.planCode === "PRO_MONTHLY");
  if (!selectedOffer || !selectedOffer.enabled || !summary.smartFields.ready) {
    return res.status(503).json({ error: "dLocal recurring setup is not configured" });
  }

  const country = normalizeCountryCode(user.country);
  if (!country) {
    return res.status(400).json({ error: "User country is required to start subscription" });
  }

  const dlocalConfig = getDLocalConfig();
  const fullName = [String(user.firstName ?? "").trim(), String(user.lastName ?? "").trim()].filter(Boolean).join(" ") || user.email;
  const orderId = `ground-pro-monthly-${user.id}-${Date.now()}`;
  const payment = await createSubscriptionPayment({
    amount: selectedOffer.amountMinor / 100,
    currency: "USD",
    country,
    orderId,
    description: "Ground Pro monthly subscription",
    notificationUrl: `${dlocalConfig.backendBaseUrl}/billing/dlocal/notifications`,
    payer: {
      name: fullName,
      email: user.email,
      userReference: user.id,
    },
    cardToken,
  });

  const paymentId = extractPaymentId(payment);
  if (!paymentId) {
    return res.status(502).json({ error: "dLocal did not return payment id" });
  }

  const billingSubscription = await prisma.billingSubscription.create({
    data: {
      userId: user.id,
      provider: BillingProvider.DLOCAL,
      planCode: BillingPlanCode.PRO_MONTHLY,
      status: BillingSubscriptionStatus.INCOMPLETE,
      currencyCode: "USD",
      amountMinor: selectedOffer.amountMinor,
      providerSubscriptionId: paymentId,
      providerCustomerId: extractProviderCustomerId(payment) || null,
      providerPaymentMethodId: extractProviderPaymentMethodId(payment) || null,
      providerCardId: extractProviderCardId(payment) || null,
      metadata: {
        orderId,
        dlocalPaymentId: paymentId,
        selectedPlanCode: "PRO_MONTHLY",
        userReference: user.id,
        startedAt: new Date().toISOString(),
        networkPaymentReference: extractNetworkPaymentReference(payment) || null,
        cardLast4: extractCardLastFour(payment) || null,
      },
    },
  });

  await prisma.billingEvent.create({
    data: {
      userId: user.id,
      billingSubscriptionId: billingSubscription.id,
      provider: BillingProvider.DLOCAL,
      eventType: "dlocal_subscription_started",
      externalId: paymentId,
      payload: payment as any,
      processedAt: new Date(),
    },
  });

  const { paymentStatus } = await persistPaymentStatus(paymentId, payment, "subscribe");
  const refreshedUser = await loadBillingUser(user.id);

  return res.json({
    ok: true,
    paymentId,
    paymentStatus,
    billing: refreshedUser ? buildBillingSummary(refreshedUser) : summary,
  });
};

export const cancelCurrentSubscription = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const currentSubscription = pickCurrentSubscription(user.billingSubscriptions as any);
  if (!currentSubscription || currentSubscription.planCode !== BillingPlanCode.PRO_MONTHLY) {
    return res.status(409).json({ error: "There is no monthly subscription to cancel" });
  }

  if (currentSubscription.cancelAtPeriodEnd) {
    return res.json({
      ok: true,
      billing: buildBillingSummary(user),
    });
  }

  let cardDeleted = false;
  if (currentSubscription.providerCardId) {
    try {
      const result = await deleteSavedCard(currentSubscription.providerCardId);
      cardDeleted = result.deleted;
      await prisma.billingEvent.create({
        data: {
          userId: user.id,
          billingSubscriptionId: currentSubscription.id,
          provider: BillingProvider.DLOCAL,
          eventType: "dlocal_card_deleted",
          externalId: currentSubscription.providerCardId,
          payload: { deleted: result.deleted },
          processedAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.billingEvent.create({
        data: {
          userId: user.id,
          billingSubscriptionId: currentSubscription.id,
          provider: BillingProvider.DLOCAL,
          eventType: "dlocal_card_delete_failed",
          externalId: currentSubscription.providerCardId,
          payload: { message: error instanceof Error ? error.message : "card-delete-failed" },
          processedAt: new Date(),
        },
      });
    }
  }

  const nextStatus =
    currentSubscription.status === BillingSubscriptionStatus.ACTIVE
      ? BillingSubscriptionStatus.CANCELED
      : currentSubscription.status;
  await prisma.billingSubscription.update({
    where: { id: currentSubscription.id },
    data: {
      status: nextStatus,
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      renewalLockedAt: null,
      ...(cardDeleted ? { providerCardId: null } : {}),
      metadata: {
        ...(currentSubscription.metadata && typeof currentSubscription.metadata === "object"
          ? (currentSubscription.metadata as Record<string, unknown>)
          : {}),
        cancelRequestedAt: new Date().toISOString(),
        cardDeletedAtCancellation: cardDeleted,
      } as any,
    },
  });

  await prisma.billingEvent.create({
    data: {
      userId: user.id,
      billingSubscriptionId: currentSubscription.id,
      provider: BillingProvider.DLOCAL,
      eventType: "subscription_canceled",
      payload: {
        cancelAtPeriodEnd: true,
        cardDeleted,
      },
      processedAt: new Date(),
    },
  });

  const refreshedUser = await loadBillingUser(user.id);
  return res.json({
    ok: true,
    billing: refreshedUser ? buildBillingSummary(refreshedUser) : buildBillingSummary(user),
  });
};

export const reactivateCurrentSubscription = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const currentSubscription = pickCurrentSubscription(user.billingSubscriptions as any);
  if (!currentSubscription || currentSubscription.planCode !== BillingPlanCode.PRO_MONTHLY) {
    return res.status(409).json({ error: "There is no monthly subscription to reactivate" });
  }

  const stillInPeriod = !!currentSubscription.currentPeriodEndsAt && new Date() <= currentSubscription.currentPeriodEndsAt;
  if (!stillInPeriod) {
    return res.status(409).json({ error: "The current subscription period already ended" });
  }

  if (!currentSubscription.cancelAtPeriodEnd) {
    const refreshedUser = await loadBillingUser(user.id);
    return res.json({
      ok: true,
      billing: refreshedUser ? buildBillingSummary(refreshedUser) : buildBillingSummary(user),
    });
  }

  const metadata =
    currentSubscription.metadata && typeof currentSubscription.metadata === "object"
      ? (currentSubscription.metadata as Record<string, unknown>)
      : {};
  let nextProviderCardId = currentSubscription.providerCardId;
  let nextCardLast4 = metadata.cardLast4 ?? null;

  if (!nextProviderCardId) {
    const cardToken = String(req.body?.cardToken ?? "").trim();
    if (!cardToken) {
      return res.status(400).json({ error: "Card token is required to reactivate renewal" });
    }
    const country = normalizeCountryCode(user.country);
    if (!country) {
      return res.status(400).json({ error: "User country is required to reactivate renewal" });
    }
    const fullName = [String(user.firstName ?? "").trim(), String(user.lastName ?? "").trim()].filter(Boolean).join(" ") || user.email;
    const savedCard = await createSavedCard({
      country,
      payer: {
        name: fullName,
        email: user.email,
        userReference: user.id,
      },
      cardToken,
    });
    nextProviderCardId = extractProviderCardId(savedCard);
    nextCardLast4 = extractCardLastFour(savedCard) || nextCardLast4;
    if (!nextProviderCardId) {
      return res.status(502).json({ error: "dLocal did not return a saved card id" });
    }
    await prisma.billingEvent.create({
      data: {
        userId: user.id,
        billingSubscriptionId: currentSubscription.id,
        provider: BillingProvider.DLOCAL,
        eventType: "dlocal_card_saved_for_reactivation",
        externalId: nextProviderCardId,
        payload: savedCard as any,
        processedAt: new Date(),
      },
    });
  }

  await prisma.billingSubscription.update({
    where: { id: currentSubscription.id },
    data: {
      status: BillingSubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      providerCardId: nextProviderCardId,
      metadata: {
        ...metadata,
        cardLast4: nextCardLast4,
        reactivatedAt: new Date().toISOString(),
        cancelRequestedAt: null,
      } as any,
    },
  });

  await prisma.billingEvent.create({
    data: {
      userId: user.id,
      billingSubscriptionId: currentSubscription.id,
      provider: BillingProvider.DLOCAL,
      eventType: "subscription_reactivated",
      payload: {
        reactivatedAt: new Date().toISOString(),
        savedCardRestored: !!nextProviderCardId,
      },
      processedAt: new Date(),
    },
  });

  const refreshedUser = await loadBillingUser(user.id);
  return res.json({
    ok: true,
    billing: refreshedUser ? buildBillingSummary(refreshedUser) : buildBillingSummary(user),
  });
};

export const runRenewalsNow = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!actor || actor.role !== UserRole.SUPER_ADMIN) {
    return res.status(403).json({ error: "Only super admins can trigger renewals" });
  }
  const result = await runDueMonthlyRenewals(Number(req.body?.limit) || 10);
  return res.json({ ok: true, result });
};

export const startProEarlyCheckout = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const summary = buildBillingSummary(user);
  if (summary.isSuperAdminBypass) {
    return res.status(400).json({ error: "Super admin accounts are excluded from billing" });
  }
  const requestedPlanCode = String(req.body?.planCode ?? "").trim().toUpperCase() as BillingPlanCode;
  if (requestedPlanCode === BillingPlanCode.PRO_MONTHLY) {
    return res.status(409).json({ error: "Monthly Pro now uses direct recurring setup" });
  }
  const selectedOffer = summary.offers.find((offer) => offer.planCode === requestedPlanCode);

  if (!selectedOffer) {
    return res.status(409).json({ error: "Selected plan is not available for this account" });
  }
  if (!selectedOffer.enabled) {
    return res.status(503).json({ error: "dLocal checkout is not configured" });
  }

  const country = normalizeCountryCode(user.country);
  if (!country) {
    return res.status(400).json({ error: "User country is required to start checkout" });
  }

  const dlocalConfig = getDLocalConfig();
  const fullName = [String(user.firstName ?? "").trim(), String(user.lastName ?? "").trim()].filter(Boolean).join(" ") || user.email;
  const orderId = `ground-pro-early-${user.id}-${Date.now()}`;

  const payment = await createRedirectPayment({
    amount: selectedOffer.amountMinor / 100,
    currency: "USD",
    country,
    orderId,
    description:
      selectedOffer.planCode === "PRO_EARLY_ANNUAL"
        ? `Ground Pro Early annual plan (${selectedOffer.durationMonths}m)`
        : "Ground Pro monthly plan",
    callbackUrl: `${dlocalConfig.backendBaseUrl}/billing/dlocal/callback`,
    notificationUrl: `${dlocalConfig.backendBaseUrl}/billing/dlocal/notifications`,
    payer: {
      name: fullName,
      email: user.email,
      userReference: user.id,
    },
  });

  const paymentId = extractPaymentId(payment);
  const redirectUrl = extractRedirectUrl(payment);
  const providerOrderId = extractOrderId(payment) || orderId;

  if (!paymentId || !redirectUrl) {
    return res.status(502).json({ error: "dLocal did not return a redirect URL" });
  }

  const billingSubscription = await prisma.billingSubscription.create({
    data: {
      userId: user.id,
      provider: BillingProvider.DLOCAL,
      planCode: selectedOffer.planCode === "PRO_EARLY_ANNUAL" ? BillingPlanCode.PRO_EARLY_ANNUAL : BillingPlanCode.PRO_MONTHLY,
      status: BillingSubscriptionStatus.INCOMPLETE,
      currencyCode: "USD",
      amountMinor: selectedOffer.amountMinor,
      providerSubscriptionId: paymentId,
      providerCustomerId: extractProviderCustomerId(payment) || null,
      providerPaymentMethodId: extractProviderPaymentMethodId(payment) || null,
      providerCardId: extractProviderCardId(payment) || null,
      metadata: {
        orderId: providerOrderId,
        redirectUrl,
        dlocalPaymentId: paymentId,
        selectedPlanCode: selectedOffer.planCode,
        userReference: user.id,
        startedAt: new Date().toISOString(),
      },
    },
  });

  await prisma.billingEvent.create({
    data: {
      userId: user.id,
      billingSubscriptionId: billingSubscription.id,
      provider: BillingProvider.DLOCAL,
      eventType: "dlocal_checkout_started",
      externalId: paymentId,
      payload: payment as any,
      processedAt: new Date(),
    },
  });

  return res.json({
    ok: true,
    redirectUrl,
    paymentId,
  });
};

export const handleDLocalNotification = async (req: Request & { rawBody?: string }, res: Response) => {
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const xDate = String(req.headers["x-date"] ?? "");
  const authorization = String(req.headers.authorization ?? "");

  if (!verifyNotificationSignature(rawBody, authorization, xDate)) {
    return res.status(401).json({ error: "Invalid dLocal signature" });
  }

  const paymentId = extractPaymentId(req.body);
  if (!paymentId) {
    return res.status(400).json({ error: "paymentId is required" });
  }

  await persistPaymentStatus(paymentId, req.body, "notification");
  return res.json({ ok: true });
};

export const handleDLocalCallback = async (req: Request, res: Response) => {
  const paymentId = extractPaymentId(req.body);
  const status = extractPaymentStatus(req.body);
  const date = String(req.body?.date ?? "");
  const signature = String(req.body?.signature ?? "");
  const dlocalConfig = getDLocalConfig();
  const redirectBase = `${dlocalConfig.frontendBaseUrl}/app/account`;

  if (!verifyCallbackSignature(paymentId, status, date, signature)) {
    return res.redirect(303, `${redirectBase}?billingResult=invalid-signature`);
  }

  try {
    const payment = await getPaymentStatus(paymentId);
    const { paymentStatus } = await persistPaymentStatus(paymentId, payment, "callback");
    return res.redirect(303, `${redirectBase}?billingResult=${encodeURIComponent(paymentStatus.toLowerCase() || "pending")}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "callback-error";
    return res.redirect(303, `${redirectBase}?billingResult=${encodeURIComponent(message)}`);
  }
};
