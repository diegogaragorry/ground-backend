import { BillingPlanCode, BillingProvider, BillingSubscriptionStatus } from "@prisma/client";
import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "../middlewares/requireAuth";
import { buildBillingSummary, getBillingConfig, getPlanDurationMonths } from "./billing.service";
import {
  createRedirectPayment,
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

async function persistPaymentStatus(paymentId: string, payload: any, source: "callback" | "notification") {
  const paymentStatus = extractPaymentStatus(payload);
  const paymentRecord = await prisma.billingSubscription.findFirst({
    where: {
      provider: BillingProvider.DLOCAL,
      providerSubscriptionId: paymentId,
    },
    orderBy: { createdAt: "desc" },
  });

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
  const normalizedStatus = paymentStatus || "UNKNOWN";

  switch (normalizedStatus) {
    case "APPROVED":
    case "PAID":
    case "AUTHORIZED":
    case "COMPLETED":
      nextStatus = BillingSubscriptionStatus.ACTIVE;
      periodEndsAt = addMonths(now, Math.max(getPlanDurationMonths(paymentRecord.planCode), 1));
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
      nextStatus = paymentRecord.status === BillingSubscriptionStatus.ACTIVE ? BillingSubscriptionStatus.PAST_DUE : BillingSubscriptionStatus.INCOMPLETE;
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
      currentPeriodStartedAt: nextStatus === BillingSubscriptionStatus.ACTIVE ? now : paymentRecord.currentPeriodStartedAt,
      currentPeriodEndsAt: nextStatus === BillingSubscriptionStatus.ACTIVE ? periodEndsAt : paymentRecord.currentPeriodEndsAt,
      endedAt,
      graceEndsAt: graceEndsAt ?? paymentRecord.graceEndsAt,
      providerCardId,
      providerPaymentMethodId,
      providerCustomerId,
      metadata: {
        ...(typeof paymentRecord.metadata === "object" && paymentRecord.metadata ? paymentRecord.metadata : {}),
        lastDlocalPayload: payload,
        lastDlocalSource: source,
        lastDlocalStatus: normalizedStatus,
        lastDlocalOrderId: extractOrderId(payload) || (paymentRecord.metadata as any)?.orderId,
        lastDlocalCardId: providerCardId,
        lastDlocalPaymentMethodId: providerPaymentMethodId,
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

export const startProEarlyCheckout = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const user = await loadBillingUser(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const summary = buildBillingSummary(user);
  if (summary.isSuperAdminBypass) {
    return res.status(400).json({ error: "Super admin accounts are excluded from billing" });
  }
  const requestedPlanCode = String(req.body?.planCode ?? "").trim().toUpperCase() as BillingPlanCode;
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
