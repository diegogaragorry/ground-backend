"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBillingConfig = getBillingConfig;
exports.pickCurrentSubscription = pickCurrentSubscription;
exports.getPlanDurationMonths = getPlanDurationMonths;
exports.buildBillingSummary = buildBillingSummary;
const client_1 = require("@prisma/client");
function readBooleanEnv(name, fallback) {
    const raw = process.env[name];
    if (raw == null)
        return fallback;
    const normalized = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized))
        return true;
    if (["0", "false", "no", "off"].includes(normalized))
        return false;
    return fallback;
}
function readPositiveIntEnv(name, fallback) {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}
function normalizeEmail(raw) {
    return String(raw ?? "").trim().toLowerCase();
}
function readEmailListEnv(name) {
    return String(process.env[name] ?? "")
        .split(",")
        .map((value) => normalizeEmail(value))
        .filter(Boolean);
}
function addMonths(date, months) {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
}
function toIsoOrNull(date) {
    return date ? date.toISOString() : null;
}
function getBillingConfig() {
    const proEarlyMonthlyUsdMinor = readPositiveIntEnv("BILLING_PRO_EARLY_MONTHLY_USD_MINOR", 399);
    const defaultAnnual = proEarlyMonthlyUsdMinor * 12;
    const checkoutAllowedEmails = readEmailListEnv("BILLING_CHECKOUT_ALLOWED_EMAILS");
    const smartFieldsKey = String(process.env.DLOCAL_SMARTFIELDS_KEY ?? process.env.DLOCAL_SMART_FIELDS_KEY ?? process.env.DLOCAL_X_LOGIN ?? "").trim() || null;
    const smartFieldsEnvironment = String(process.env.DLOCAL_API_BASE_URL ?? "").trim().includes("sandbox") || process.env.NODE_ENV !== "production"
        ? "sandbox"
        : "production";
    const integrationReady = !!(String(process.env.DLOCAL_X_LOGIN ?? "").trim() &&
        String(process.env.DLOCAL_X_TRANS_KEY ?? "").trim() &&
        String(process.env.DLOCAL_SECRET_KEY ?? "").trim());
    const smartFieldsReady = integrationReady && !!smartFieldsKey;
    const billingEnabled = readBooleanEnv("BILLING_ENABLED", true);
    return {
        provider: client_1.BillingProvider.DLOCAL,
        billingEnabled,
        integrationReady,
        checkoutReady: smartFieldsReady,
        checkoutAllowedEmails,
        customerPortalReady: false,
        smartFieldsReady,
        smartFieldsKey,
        smartFieldsEnvironment,
        earlyStageMonths: readPositiveIntEnv("BILLING_EARLY_STAGE_MONTHS", 2),
        graceDays: readPositiveIntEnv("BILLING_GRACE_DAYS", 7),
        proEarlyMonthlyUsdMinor,
        proEarlyAnnualUsdMinor: readPositiveIntEnv("BILLING_PRO_EARLY_ANNUAL_USD_MINOR", defaultAnnual),
        proStandardMonthlyUsdMinor: readPositiveIntEnv("BILLING_PRO_STANDARD_MONTHLY_USD_MINOR", 599),
        proMonthlyUsdMinor: readPositiveIntEnv("BILLING_PRO_MONTHLY_USD_MINOR", 399),
    };
}
function isCheckoutAllowedForUser(config, userEmail) {
    if (!config.checkoutReady)
        return false;
    if (config.checkoutAllowedEmails.length === 0) {
        return process.env.NODE_ENV !== "production";
    }
    return config.checkoutAllowedEmails.includes(normalizeEmail(userEmail));
}
function subscriptionPriority(status) {
    switch (status) {
        case client_1.BillingSubscriptionStatus.ACTIVE:
            return 100;
        case client_1.BillingSubscriptionStatus.TRIALING:
            return 90;
        case client_1.BillingSubscriptionStatus.PAST_DUE:
            return 80;
        case client_1.BillingSubscriptionStatus.INCOMPLETE:
            return 70;
        case client_1.BillingSubscriptionStatus.CANCELED:
            return 60;
        case client_1.BillingSubscriptionStatus.PAUSED:
            return 50;
        case client_1.BillingSubscriptionStatus.EXPIRED:
            return 40;
        default:
            return 0;
    }
}
function pickCurrentSubscription(subscriptions) {
    if (!subscriptions.length)
        return null;
    return [...subscriptions].sort((a, b) => {
        const priorityDelta = subscriptionPriority(b.status) - subscriptionPriority(a.status);
        if (priorityDelta !== 0)
            return priorityDelta;
        return b.createdAt.getTime() - a.createdAt.getTime();
    })[0] ?? null;
}
function buildOffers(config, enabled) {
    return [
        {
            planCode: "PRO_EARLY_ANNUAL",
            amountMinor: config.proEarlyAnnualUsdMinor,
            monthlyEquivalentMinor: config.proEarlyMonthlyUsdMinor,
            currencyCode: "USD",
            durationMonths: 12,
            billingInterval: "annual",
            enabled,
            cancelAnytime: false,
        },
        {
            planCode: "PRO_MONTHLY",
            amountMinor: config.proMonthlyUsdMinor,
            monthlyEquivalentMinor: config.proMonthlyUsdMinor,
            currencyCode: "USD",
            durationMonths: 1,
            billingInterval: "monthly",
            enabled,
            cancelAnytime: true,
        },
    ];
}
function baseSummary(config) {
    return {
        provider: config.provider,
        billingEnabled: config.billingEnabled,
        integrationReady: config.integrationReady,
        checkoutReady: config.checkoutReady,
        customerPortalReady: config.customerPortalReady,
        smartFields: {
            ready: config.smartFieldsReady,
            key: config.smartFieldsKey,
            environment: config.smartFieldsEnvironment,
        },
        planCode: client_1.BillingPlanCode.EARLY_STAGE,
        subscriptionStatus: "active",
        accessLevel: "full",
        nextAction: config.checkoutReady ? "start_checkout" : "contact_support",
        isSuperAdminBypass: false,
        planEndsAt: null,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        canCancelCurrentSubscription: false,
        price: {
            amountMinor: config.proEarlyMonthlyUsdMinor,
            currencyCode: "USD",
        },
        offers: buildOffers(config, config.checkoutReady),
        commercialPolicy: {
            earlyStageMonths: config.earlyStageMonths,
            graceDays: config.graceDays,
            proEarlyMonthlyUsdMinor: config.proEarlyMonthlyUsdMinor,
            proEarlyAnnualUsdMinor: config.proEarlyAnnualUsdMinor,
            proStandardMonthlyUsdMinor: config.proStandardMonthlyUsdMinor,
            proMonthlyUsdMinor: config.proMonthlyUsdMinor,
        },
        notes: [],
    };
}
function withCurrentSubscription(summary, subscription) {
    return {
        ...summary,
        planCode: subscription.planCode,
        planEndsAt: toIsoOrNull(subscription.currentPeriodEndsAt ?? subscription.trialEndsAt ?? subscription.endedAt),
        graceEndsAt: toIsoOrNull(subscription.graceEndsAt),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canCancelCurrentSubscription: subscription.planCode === client_1.BillingPlanCode.PRO_MONTHLY &&
            subscription.status === client_1.BillingSubscriptionStatus.ACTIVE &&
            !subscription.cancelAtPeriodEnd,
        price: {
            amountMinor: subscription.amountMinor,
            currencyCode: "USD",
        },
    };
}
function getPlanDurationMonths(planCode) {
    if (planCode === client_1.BillingPlanCode.PRO_EARLY_ANNUAL)
        return 12;
    if (planCode === client_1.BillingPlanCode.PRO_MONTHLY)
        return 1;
    return 0;
}
function buildBillingSummary(user) {
    const config = getBillingConfig();
    const checkoutAllowed = isCheckoutAllowedForUser(config, user.email);
    const nextCheckoutAction = checkoutAllowed ? "start_checkout" : "contact_support";
    const summary = {
        ...baseSummary(config),
        offers: buildOffers(config, checkoutAllowed),
        nextAction: nextCheckoutAction,
    };
    const now = new Date();
    if (user.role === "SUPER_ADMIN") {
        return {
            ...summary,
            planCode: client_1.BillingPlanCode.LEGACY_FREE,
            subscriptionStatus: "active",
            accessLevel: "full",
            nextAction: "none",
            isSuperAdminBypass: true,
            offers: [],
            canCancelCurrentSubscription: false,
            notes: ["super_admin_bypass"],
        };
    }
    const currentSubscription = pickCurrentSubscription(user.billingSubscriptions);
    if (currentSubscription) {
        const withSubscription = withCurrentSubscription(summary, currentSubscription);
        const offers = currentSubscription.status === client_1.BillingSubscriptionStatus.ACTIVE ? [] : summary.offers;
        switch (currentSubscription.status) {
            case client_1.BillingSubscriptionStatus.ACTIVE:
                return {
                    ...withSubscription,
                    subscriptionStatus: "active",
                    accessLevel: "full",
                    nextAction: "none",
                    offers: [],
                };
            case client_1.BillingSubscriptionStatus.TRIALING:
                return {
                    ...withSubscription,
                    subscriptionStatus: "active",
                    accessLevel: "full",
                    nextAction: "none",
                    offers,
                    notes: ["paid_subscription_trialing"],
                };
            case client_1.BillingSubscriptionStatus.PAST_DUE: {
                const inGrace = !!currentSubscription.graceEndsAt && now <= currentSubscription.graceEndsAt;
                return {
                    ...withSubscription,
                    subscriptionStatus: "past_due",
                    accessLevel: inGrace ? "full" : "read_only",
                    nextAction: checkoutAllowed ? "update_payment_method" : "contact_support",
                    offers,
                    notes: inGrace ? ["past_due_in_grace"] : ["past_due_grace_expired"],
                };
            }
            case client_1.BillingSubscriptionStatus.CANCELED: {
                const stillInPeriod = !!currentSubscription.currentPeriodEndsAt && now <= currentSubscription.currentPeriodEndsAt;
                return {
                    ...withSubscription,
                    subscriptionStatus: "canceled",
                    accessLevel: stillInPeriod ? "full" : "read_only",
                    nextAction: stillInPeriod ? "manage_subscription" : "start_checkout",
                    offers,
                    notes: stillInPeriod ? ["canceled_end_of_period"] : ["canceled_period_ended"],
                };
            }
            case client_1.BillingSubscriptionStatus.INCOMPLETE:
                return {
                    ...withSubscription,
                    subscriptionStatus: "incomplete",
                    accessLevel: "full",
                    nextAction: checkoutAllowed ? "start_checkout" : "contact_support",
                    offers,
                    notes: ["subscription_incomplete"],
                };
            case client_1.BillingSubscriptionStatus.PAUSED:
                return {
                    ...withSubscription,
                    subscriptionStatus: "paused",
                    accessLevel: "read_only",
                    nextAction: "contact_support",
                    offers,
                    notes: ["subscription_paused"],
                };
            case client_1.BillingSubscriptionStatus.EXPIRED:
            default:
                return {
                    ...withSubscription,
                    subscriptionStatus: "expired",
                    accessLevel: config.billingEnabled ? "read_only" : "full",
                    nextAction: checkoutAllowed ? "start_checkout" : "contact_support",
                    offers,
                    notes: ["subscription_expired"],
                };
        }
    }
    const earlyStageEndsAt = addMonths(user.createdAt, config.earlyStageMonths);
    const earlyStageExpired = now > earlyStageEndsAt;
    return {
        ...summary,
        planCode: client_1.BillingPlanCode.EARLY_STAGE,
        subscriptionStatus: earlyStageExpired && config.billingEnabled ? "payment_required" : "active",
        accessLevel: earlyStageExpired && config.billingEnabled ? "read_only" : "full",
        nextAction: checkoutAllowed ? "start_checkout" : "contact_support",
        planEndsAt: earlyStageEndsAt.toISOString(),
        notes: [
            earlyStageExpired ? "early_stage_expired" : "early_stage_access",
            checkoutAllowed ? "checkout_enabled" : "checkout_restricted",
        ],
    };
}
