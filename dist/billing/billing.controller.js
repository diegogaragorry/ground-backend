"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDLocalCallback = exports.handleDLocalNotification = exports.startProEarlyCheckout = exports.runRenewalsNow = exports.reactivateCurrentSubscription = exports.cancelCurrentSubscription = exports.subscribeMonthlyPlan = exports.getBillingSummary = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const billing_service_1 = require("./billing.service");
const dlocal_service_1 = require("./dlocal.service");
const renewals_service_1 = require("./renewals.service");
const billingUserSelect = {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    country: true,
    role: true,
    createdAt: true,
    billingSubscriptions: {
        orderBy: { createdAt: "desc" },
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
function addMonths(date, months) {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
}
function addDays(date, days) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
function normalizeCountryCode(raw) {
    const value = String(raw ?? "").trim().toUpperCase();
    return /^[A-Z]{2}$/.test(value) ? value : "";
}
async function loadBillingUser(userId) {
    return prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: billingUserSelect,
    });
}
async function loadPaymentRecord(paymentId) {
    const paymentEvent = await prisma_1.prisma.billingEvent.findFirst({
        where: {
            provider: client_1.BillingProvider.DLOCAL,
            externalId: paymentId,
            billingSubscriptionId: { not: null },
        },
        orderBy: { createdAt: "desc" },
    });
    if (paymentEvent?.billingSubscriptionId) {
        const subscription = await prisma_1.prisma.billingSubscription.findUnique({
            where: { id: paymentEvent.billingSubscriptionId },
        });
        if (subscription) {
            return {
                subscription,
                paymentEvent,
            };
        }
    }
    const subscription = await prisma_1.prisma.billingSubscription.findFirst({
        where: {
            provider: client_1.BillingProvider.DLOCAL,
            providerSubscriptionId: paymentId,
        },
        orderBy: { createdAt: "desc" },
    });
    return {
        subscription,
        paymentEvent,
    };
}
async function persistPaymentStatus(paymentId, payload, source) {
    const paymentStatus = (0, dlocal_service_1.extractPaymentStatus)(payload);
    const { subscription: paymentRecord, paymentEvent } = await loadPaymentRecord(paymentId);
    if (!paymentRecord) {
        return { paymentStatus, billingSubscriptionId: null };
    }
    const config = (0, billing_service_1.getBillingConfig)();
    const now = new Date();
    let nextStatus;
    let periodEndsAt = null;
    let endedAt = null;
    let graceEndsAt = null;
    const providerCardId = (0, dlocal_service_1.extractProviderCardId)(payload) || paymentRecord.providerCardId;
    const providerPaymentMethodId = (0, dlocal_service_1.extractProviderPaymentMethodId)(payload) || paymentRecord.providerPaymentMethodId;
    const providerCustomerId = (0, dlocal_service_1.extractProviderCustomerId)(payload) || paymentRecord.providerCustomerId;
    const metadata = paymentRecord.metadata && typeof paymentRecord.metadata === "object"
        ? paymentRecord.metadata
        : {};
    const isRenewalPayment = paymentEvent?.eventType === "dlocal_renewal_started";
    const activePeriodStart = isRenewalPayment && paymentRecord.currentPeriodEndsAt ? paymentRecord.currentPeriodEndsAt : now;
    const normalizedStatus = paymentStatus || "UNKNOWN";
    const alreadyApplied = String(metadata.lastAppliedPaymentId ?? "") === paymentId;
    if (alreadyApplied && ["APPROVED", "PAID", "AUTHORIZED", "COMPLETED"].includes(normalizedStatus)) {
        await prisma_1.prisma.billingEvent.create({
            data: {
                userId: paymentRecord.userId,
                billingSubscriptionId: paymentRecord.id,
                provider: client_1.BillingProvider.DLOCAL,
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
            nextStatus = client_1.BillingSubscriptionStatus.ACTIVE;
            periodEndsAt = addMonths(activePeriodStart, Math.max((0, billing_service_1.getPlanDurationMonths)(paymentRecord.planCode), 1));
            break;
        case "PENDING":
        case "CREATED":
        case "IN_PROCESS":
        case "PROCESSING":
        case "VERIFIED":
            nextStatus = client_1.BillingSubscriptionStatus.INCOMPLETE;
            break;
        case "FAILED":
        case "EXPIRED":
        case "DECLINED":
            nextStatus =
                paymentRecord.status === client_1.BillingSubscriptionStatus.ACTIVE || isRenewalPayment
                    ? client_1.BillingSubscriptionStatus.PAST_DUE
                    : client_1.BillingSubscriptionStatus.INCOMPLETE;
            graceEndsAt = nextStatus === client_1.BillingSubscriptionStatus.PAST_DUE ? addDays(now, config.graceDays) : paymentRecord.graceEndsAt;
            break;
        case "CANCELLED":
        case "CANCELED":
        case "REJECTED":
            nextStatus = client_1.BillingSubscriptionStatus.CANCELED;
            endedAt = now;
            break;
        default:
            nextStatus = client_1.BillingSubscriptionStatus.INCOMPLETE;
            break;
    }
    const updated = await prisma_1.prisma.billingSubscription.update({
        where: { id: paymentRecord.id },
        data: {
            status: nextStatus,
            currentPeriodStartedAt: nextStatus === client_1.BillingSubscriptionStatus.ACTIVE ? activePeriodStart : paymentRecord.currentPeriodStartedAt,
            currentPeriodEndsAt: nextStatus === client_1.BillingSubscriptionStatus.ACTIVE ? periodEndsAt : paymentRecord.currentPeriodEndsAt,
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
                lastDlocalOrderId: (0, dlocal_service_1.extractOrderId)(payload) || metadata.orderId,
                lastDlocalCardId: providerCardId,
                lastDlocalPaymentMethodId: providerPaymentMethodId,
                networkPaymentReference: (0, dlocal_service_1.extractNetworkPaymentReference)(payload) || metadata.networkPaymentReference || null,
                cardLast4: (0, dlocal_service_1.extractCardLastFour)(payload) || metadata.cardLast4 || null,
                lastAppliedPaymentId: nextStatus === client_1.BillingSubscriptionStatus.ACTIVE ? paymentId : metadata.lastAppliedPaymentId || null,
                graceDays: config.graceDays,
            },
        },
    });
    await prisma_1.prisma.billingEvent.create({
        data: {
            userId: paymentRecord.userId,
            billingSubscriptionId: updated.id,
            provider: client_1.BillingProvider.DLOCAL,
            eventType: `dlocal_${source}_${normalizedStatus.toLowerCase() || "unknown"}`,
            externalId: paymentId,
            payload,
            processedAt: new Date(),
        },
    });
    return { paymentStatus: normalizedStatus, billingSubscriptionId: updated.id };
}
const getBillingSummary = async (req, res) => {
    const userId = req.userId;
    const user = await loadBillingUser(userId);
    if (!user)
        return res.status(404).json({ error: "User not found" });
    return res.json((0, billing_service_1.buildBillingSummary)(user));
};
exports.getBillingSummary = getBillingSummary;
const subscribeMonthlyPlan = async (req, res) => {
    const userId = req.userId;
    const user = await loadBillingUser(userId);
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const summary = (0, billing_service_1.buildBillingSummary)(user);
    if (summary.isSuperAdminBypass) {
        return res.status(400).json({ error: "Super admin accounts are excluded from billing" });
    }
    const currentSubscription = (0, billing_service_1.pickCurrentSubscription)(user.billingSubscriptions);
    if (currentSubscription &&
        currentSubscription.planCode === client_1.BillingPlanCode.PRO_MONTHLY &&
        currentSubscription.status === client_1.BillingSubscriptionStatus.ACTIVE &&
        !currentSubscription.cancelAtPeriodEnd) {
        return res.status(409).json({ error: "There is already an active monthly subscription" });
    }
    const requestedPlanCode = String(req.body?.planCode ?? "").trim().toUpperCase();
    if (requestedPlanCode !== client_1.BillingPlanCode.PRO_MONTHLY) {
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
    const dlocalConfig = (0, dlocal_service_1.getDLocalConfig)();
    const fullName = [String(user.firstName ?? "").trim(), String(user.lastName ?? "").trim()].filter(Boolean).join(" ") || user.email;
    const orderId = `ground-pro-monthly-${user.id}-${Date.now()}`;
    const payment = await (0, dlocal_service_1.createSubscriptionPayment)({
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
    const paymentId = (0, dlocal_service_1.extractPaymentId)(payment);
    if (!paymentId) {
        return res.status(502).json({ error: "dLocal did not return payment id" });
    }
    const billingSubscription = await prisma_1.prisma.billingSubscription.create({
        data: {
            userId: user.id,
            provider: client_1.BillingProvider.DLOCAL,
            planCode: client_1.BillingPlanCode.PRO_MONTHLY,
            status: client_1.BillingSubscriptionStatus.INCOMPLETE,
            currencyCode: "USD",
            amountMinor: selectedOffer.amountMinor,
            providerSubscriptionId: paymentId,
            providerCustomerId: (0, dlocal_service_1.extractProviderCustomerId)(payment) || null,
            providerPaymentMethodId: (0, dlocal_service_1.extractProviderPaymentMethodId)(payment) || null,
            providerCardId: (0, dlocal_service_1.extractProviderCardId)(payment) || null,
            metadata: {
                orderId,
                dlocalPaymentId: paymentId,
                selectedPlanCode: "PRO_MONTHLY",
                userReference: user.id,
                startedAt: new Date().toISOString(),
                networkPaymentReference: (0, dlocal_service_1.extractNetworkPaymentReference)(payment) || null,
                cardLast4: (0, dlocal_service_1.extractCardLastFour)(payment) || null,
            },
        },
    });
    await prisma_1.prisma.billingEvent.create({
        data: {
            userId: user.id,
            billingSubscriptionId: billingSubscription.id,
            provider: client_1.BillingProvider.DLOCAL,
            eventType: "dlocal_subscription_started",
            externalId: paymentId,
            payload: payment,
            processedAt: new Date(),
        },
    });
    const { paymentStatus } = await persistPaymentStatus(paymentId, payment, "subscribe");
    const refreshedUser = await loadBillingUser(user.id);
    return res.json({
        ok: true,
        paymentId,
        paymentStatus,
        billing: refreshedUser ? (0, billing_service_1.buildBillingSummary)(refreshedUser) : summary,
    });
};
exports.subscribeMonthlyPlan = subscribeMonthlyPlan;
const cancelCurrentSubscription = async (req, res) => {
    const userId = req.userId;
    const user = await loadBillingUser(userId);
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const currentSubscription = (0, billing_service_1.pickCurrentSubscription)(user.billingSubscriptions);
    if (!currentSubscription || currentSubscription.planCode !== client_1.BillingPlanCode.PRO_MONTHLY) {
        return res.status(409).json({ error: "There is no monthly subscription to cancel" });
    }
    if (currentSubscription.cancelAtPeriodEnd) {
        return res.json({
            ok: true,
            billing: (0, billing_service_1.buildBillingSummary)(user),
        });
    }
    let cardDeleted = false;
    if (currentSubscription.providerCardId) {
        try {
            const result = await (0, dlocal_service_1.deleteSavedCard)(currentSubscription.providerCardId);
            cardDeleted = result.deleted;
            await prisma_1.prisma.billingEvent.create({
                data: {
                    userId: user.id,
                    billingSubscriptionId: currentSubscription.id,
                    provider: client_1.BillingProvider.DLOCAL,
                    eventType: "dlocal_card_deleted",
                    externalId: currentSubscription.providerCardId,
                    payload: { deleted: result.deleted },
                    processedAt: new Date(),
                },
            });
        }
        catch (error) {
            await prisma_1.prisma.billingEvent.create({
                data: {
                    userId: user.id,
                    billingSubscriptionId: currentSubscription.id,
                    provider: client_1.BillingProvider.DLOCAL,
                    eventType: "dlocal_card_delete_failed",
                    externalId: currentSubscription.providerCardId,
                    payload: { message: error instanceof Error ? error.message : "card-delete-failed" },
                    processedAt: new Date(),
                },
            });
        }
    }
    const nextStatus = currentSubscription.status === client_1.BillingSubscriptionStatus.ACTIVE
        ? client_1.BillingSubscriptionStatus.CANCELED
        : currentSubscription.status;
    await prisma_1.prisma.billingSubscription.update({
        where: { id: currentSubscription.id },
        data: {
            status: nextStatus,
            cancelAtPeriodEnd: true,
            canceledAt: new Date(),
            renewalLockedAt: null,
            ...(cardDeleted ? { providerCardId: null } : {}),
            metadata: {
                ...(currentSubscription.metadata && typeof currentSubscription.metadata === "object"
                    ? currentSubscription.metadata
                    : {}),
                cancelRequestedAt: new Date().toISOString(),
                cardDeletedAtCancellation: cardDeleted,
            },
        },
    });
    await prisma_1.prisma.billingEvent.create({
        data: {
            userId: user.id,
            billingSubscriptionId: currentSubscription.id,
            provider: client_1.BillingProvider.DLOCAL,
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
        billing: refreshedUser ? (0, billing_service_1.buildBillingSummary)(refreshedUser) : (0, billing_service_1.buildBillingSummary)(user),
    });
};
exports.cancelCurrentSubscription = cancelCurrentSubscription;
const reactivateCurrentSubscription = async (req, res) => {
    const userId = req.userId;
    const user = await loadBillingUser(userId);
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const currentSubscription = (0, billing_service_1.pickCurrentSubscription)(user.billingSubscriptions);
    if (!currentSubscription || currentSubscription.planCode !== client_1.BillingPlanCode.PRO_MONTHLY) {
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
            billing: refreshedUser ? (0, billing_service_1.buildBillingSummary)(refreshedUser) : (0, billing_service_1.buildBillingSummary)(user),
        });
    }
    const metadata = currentSubscription.metadata && typeof currentSubscription.metadata === "object"
        ? currentSubscription.metadata
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
        const savedCard = await (0, dlocal_service_1.createSavedCard)({
            country,
            payer: {
                name: fullName,
                email: user.email,
                userReference: user.id,
            },
            cardToken,
        });
        nextProviderCardId = (0, dlocal_service_1.extractProviderCardId)(savedCard);
        nextCardLast4 = (0, dlocal_service_1.extractCardLastFour)(savedCard) || nextCardLast4;
        if (!nextProviderCardId) {
            return res.status(502).json({ error: "dLocal did not return a saved card id" });
        }
        await prisma_1.prisma.billingEvent.create({
            data: {
                userId: user.id,
                billingSubscriptionId: currentSubscription.id,
                provider: client_1.BillingProvider.DLOCAL,
                eventType: "dlocal_card_saved_for_reactivation",
                externalId: nextProviderCardId,
                payload: savedCard,
                processedAt: new Date(),
            },
        });
    }
    await prisma_1.prisma.billingSubscription.update({
        where: { id: currentSubscription.id },
        data: {
            status: client_1.BillingSubscriptionStatus.ACTIVE,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            endedAt: null,
            providerCardId: nextProviderCardId,
            metadata: {
                ...metadata,
                cardLast4: nextCardLast4,
                reactivatedAt: new Date().toISOString(),
                cancelRequestedAt: null,
            },
        },
    });
    await prisma_1.prisma.billingEvent.create({
        data: {
            userId: user.id,
            billingSubscriptionId: currentSubscription.id,
            provider: client_1.BillingProvider.DLOCAL,
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
        billing: refreshedUser ? (0, billing_service_1.buildBillingSummary)(refreshedUser) : (0, billing_service_1.buildBillingSummary)(user),
    });
};
exports.reactivateCurrentSubscription = reactivateCurrentSubscription;
const runRenewalsNow = async (req, res) => {
    const userId = req.userId;
    const actor = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
    });
    if (!actor || actor.role !== client_1.UserRole.SUPER_ADMIN) {
        return res.status(403).json({ error: "Only super admins can trigger renewals" });
    }
    const result = await (0, renewals_service_1.runDueMonthlyRenewals)(Number(req.body?.limit) || 10);
    return res.json({ ok: true, result });
};
exports.runRenewalsNow = runRenewalsNow;
const startProEarlyCheckout = async (req, res) => {
    const userId = req.userId;
    const user = await loadBillingUser(userId);
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const summary = (0, billing_service_1.buildBillingSummary)(user);
    if (summary.isSuperAdminBypass) {
        return res.status(400).json({ error: "Super admin accounts are excluded from billing" });
    }
    const requestedPlanCode = String(req.body?.planCode ?? "").trim().toUpperCase();
    if (requestedPlanCode === client_1.BillingPlanCode.PRO_MONTHLY) {
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
    const dlocalConfig = (0, dlocal_service_1.getDLocalConfig)();
    const fullName = [String(user.firstName ?? "").trim(), String(user.lastName ?? "").trim()].filter(Boolean).join(" ") || user.email;
    const orderId = `ground-pro-early-${user.id}-${Date.now()}`;
    const payment = await (0, dlocal_service_1.createRedirectPayment)({
        amount: selectedOffer.amountMinor / 100,
        currency: "USD",
        country,
        orderId,
        description: selectedOffer.planCode === "PRO_EARLY_ANNUAL"
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
    const paymentId = (0, dlocal_service_1.extractPaymentId)(payment);
    const redirectUrl = (0, dlocal_service_1.extractRedirectUrl)(payment);
    const providerOrderId = (0, dlocal_service_1.extractOrderId)(payment) || orderId;
    if (!paymentId || !redirectUrl) {
        return res.status(502).json({ error: "dLocal did not return a redirect URL" });
    }
    const billingSubscription = await prisma_1.prisma.billingSubscription.create({
        data: {
            userId: user.id,
            provider: client_1.BillingProvider.DLOCAL,
            planCode: selectedOffer.planCode === "PRO_EARLY_ANNUAL" ? client_1.BillingPlanCode.PRO_EARLY_ANNUAL : client_1.BillingPlanCode.PRO_MONTHLY,
            status: client_1.BillingSubscriptionStatus.INCOMPLETE,
            currencyCode: "USD",
            amountMinor: selectedOffer.amountMinor,
            providerSubscriptionId: paymentId,
            providerCustomerId: (0, dlocal_service_1.extractProviderCustomerId)(payment) || null,
            providerPaymentMethodId: (0, dlocal_service_1.extractProviderPaymentMethodId)(payment) || null,
            providerCardId: (0, dlocal_service_1.extractProviderCardId)(payment) || null,
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
    await prisma_1.prisma.billingEvent.create({
        data: {
            userId: user.id,
            billingSubscriptionId: billingSubscription.id,
            provider: client_1.BillingProvider.DLOCAL,
            eventType: "dlocal_checkout_started",
            externalId: paymentId,
            payload: payment,
            processedAt: new Date(),
        },
    });
    return res.json({
        ok: true,
        redirectUrl,
        paymentId,
    });
};
exports.startProEarlyCheckout = startProEarlyCheckout;
const handleDLocalNotification = async (req, res) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const xDate = String(req.headers["x-date"] ?? "");
    const authorization = String(req.headers.authorization ?? "");
    if (!(0, dlocal_service_1.verifyNotificationSignature)(rawBody, authorization, xDate)) {
        return res.status(401).json({ error: "Invalid dLocal signature" });
    }
    const paymentId = (0, dlocal_service_1.extractPaymentId)(req.body);
    if (!paymentId) {
        return res.status(400).json({ error: "paymentId is required" });
    }
    await persistPaymentStatus(paymentId, req.body, "notification");
    return res.json({ ok: true });
};
exports.handleDLocalNotification = handleDLocalNotification;
const handleDLocalCallback = async (req, res) => {
    const paymentId = (0, dlocal_service_1.extractPaymentId)(req.body);
    const status = (0, dlocal_service_1.extractPaymentStatus)(req.body);
    const date = String(req.body?.date ?? "");
    const signature = String(req.body?.signature ?? "");
    const dlocalConfig = (0, dlocal_service_1.getDLocalConfig)();
    const redirectBase = `${dlocalConfig.frontendBaseUrl}/app/account`;
    if (!(0, dlocal_service_1.verifyCallbackSignature)(paymentId, status, date, signature)) {
        return res.redirect(303, `${redirectBase}?billingResult=invalid-signature`);
    }
    try {
        const payment = await (0, dlocal_service_1.getPaymentStatus)(paymentId);
        const { paymentStatus } = await persistPaymentStatus(paymentId, payment, "callback");
        return res.redirect(303, `${redirectBase}?billingResult=${encodeURIComponent(paymentStatus.toLowerCase() || "pending")}`);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "callback-error";
        return res.redirect(303, `${redirectBase}?billingResult=${encodeURIComponent(message)}`);
    }
};
exports.handleDLocalCallback = handleDLocalCallback;
