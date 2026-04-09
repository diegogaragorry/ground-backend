import {
  BillingPlanCode,
  BillingProvider,
  BillingSubscriptionStatus,
  type BillingSubscription,
  type UserRole,
} from "@prisma/client";

type AccessLevel = "full" | "read_only";
type BillingSummaryStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "paused"
  | "incomplete"
  | "payment_required";
type BillingNextAction = "none" | "start_checkout" | "manage_subscription" | "update_payment_method" | "contact_support";

type BillingUser = {
  id: string;
  email: string;
  role: UserRole;
  specialGuest: boolean;
  createdAt: Date;
  billingSubscriptions: Array<{
    id: string;
    provider: BillingProvider;
    planCode: BillingPlanCode;
    status: BillingSubscriptionStatus;
    currencyCode: string;
    amountMinor: number;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    currentPeriodStartedAt: Date | null;
    currentPeriodEndsAt: Date | null;
    graceEndsAt: Date | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: Date | null;
    endedAt: Date | null;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    providerPaymentMethodId: string | null;
    providerCardId: string | null;
    metadata?: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

type BillingOffer = {
  planCode: "PRO_EARLY_ANNUAL" | "PRO_MONTHLY";
  amountMinor: number;
  monthlyEquivalentMinor: number;
  currencyCode: "USD";
  durationMonths: number;
  billingInterval: "monthly" | "annual";
  enabled: boolean;
  cancelAnytime: boolean;
};

export type BillingSummary = {
  provider: BillingProvider;
  billingEnabled: boolean;
  integrationReady: boolean;
  checkoutReady: boolean;
  customerPortalReady: boolean;
  smartFields: {
    ready: boolean;
    key: string | null;
    environment: "sandbox" | "production";
  };
  planCode: BillingPlanCode;
  subscriptionStatus: BillingSummaryStatus;
  accessLevel: AccessLevel;
  nextAction: BillingNextAction;
  isSuperAdminBypass: boolean;
  planEndsAt: string | null;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  canCancelCurrentSubscription: boolean;
  canReactivateCurrentSubscription: boolean;
  reactivationRequiresCard: boolean;
  price: {
    amountMinor: number;
    currencyCode: "USD";
  };
  offers: BillingOffer[];
  commercialPolicy: {
    earlyStageMonths: number;
    graceDays: number;
    proEarlyMonthlyUsdMinor: number;
    proEarlyAnnualUsdMinor: number;
    proStandardMonthlyUsdMinor: number;
    proMonthlyUsdMinor: number;
  };
  notes: string[];
};

type BillingConfig = {
  provider: BillingProvider;
  billingEnabled: boolean;
  integrationReady: boolean;
  checkoutReady: boolean;
  checkoutAllowedEmails: string[];
  customerPortalReady: boolean;
  smartFieldsReady: boolean;
  smartFieldsKey: string | null;
  smartFieldsEnvironment: "sandbox" | "production";
  earlyStageMonths: number;
  earlyStageSpecialGuestMonths: number;
  graceDays: number;
  proEarlyMonthlyUsdMinor: number;
  proEarlyAnnualUsdMinor: number;
  proStandardMonthlyUsdMinor: number;
  proMonthlyUsdMinor: number;
};

function readBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function normalizeEmail(raw: string | null | undefined) {
  return String(raw ?? "").trim().toLowerCase();
}

function readEmailListEnv(name: string) {
  return String(process.env[name] ?? "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function toIsoOrNull(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

export function getBillingConfig(): BillingConfig {
  const proEarlyMonthlyUsdMinor = readPositiveIntEnv("BILLING_PRO_EARLY_MONTHLY_USD_MINOR", 399);
  const defaultAnnual = proEarlyMonthlyUsdMinor * 12;
  const checkoutAllowedEmails = readEmailListEnv("BILLING_CHECKOUT_ALLOWED_EMAILS");
  const earlyStageMonths = readPositiveIntEnv("BILLING_EARLY_STAGE_MONTHS", 2);
  const earlyStageSpecialGuestMonths = readPositiveIntEnv("BILLING_EARLY_STAGE_SPECIAL_GUEST_MONTHS", 4);
  const smartFieldsKey =
    String(process.env.DLOCAL_SMARTFIELDS_KEY ?? process.env.DLOCAL_SMART_FIELDS_KEY ?? process.env.DLOCAL_X_LOGIN ?? "").trim() || null;
  const smartFieldsEnvironment =
    String(process.env.DLOCAL_API_BASE_URL ?? "").trim().includes("sandbox") || process.env.NODE_ENV !== "production"
      ? "sandbox"
      : "production";
  const integrationReady = !!(
    String(process.env.DLOCAL_X_LOGIN ?? "").trim() &&
    String(process.env.DLOCAL_X_TRANS_KEY ?? "").trim() &&
    String(process.env.DLOCAL_SECRET_KEY ?? "").trim()
  );
  const smartFieldsReady = integrationReady && !!smartFieldsKey;
  const billingEnabled = readBooleanEnv("BILLING_ENABLED", true);
  return {
    provider: BillingProvider.DLOCAL,
    billingEnabled,
    integrationReady,
    checkoutReady: smartFieldsReady,
    checkoutAllowedEmails,
    customerPortalReady: false,
    smartFieldsReady,
    smartFieldsKey,
    smartFieldsEnvironment,
    earlyStageMonths,
    earlyStageSpecialGuestMonths,
    graceDays: readPositiveIntEnv("BILLING_GRACE_DAYS", 7),
    proEarlyMonthlyUsdMinor,
    proEarlyAnnualUsdMinor: readPositiveIntEnv("BILLING_PRO_EARLY_ANNUAL_USD_MINOR", defaultAnnual),
    proStandardMonthlyUsdMinor: readPositiveIntEnv("BILLING_PRO_STANDARD_MONTHLY_USD_MINOR", 599),
    proMonthlyUsdMinor: readPositiveIntEnv("BILLING_PRO_MONTHLY_USD_MINOR", 399),
  };
}

function isCheckoutAllowedForUser(config: BillingConfig, userEmail: string) {
  if (!config.checkoutReady) return false;
  if (config.checkoutAllowedEmails.length === 0) {
    return process.env.NODE_ENV !== "production";
  }
  return config.checkoutAllowedEmails.includes(normalizeEmail(userEmail));
}

function subscriptionPriority(status: BillingSubscriptionStatus) {
  switch (status) {
    case BillingSubscriptionStatus.ACTIVE:
      return 100;
    case BillingSubscriptionStatus.TRIALING:
      return 90;
    case BillingSubscriptionStatus.PAST_DUE:
      return 80;
    case BillingSubscriptionStatus.INCOMPLETE:
      return 70;
    case BillingSubscriptionStatus.CANCELED:
      return 60;
    case BillingSubscriptionStatus.PAUSED:
      return 50;
    case BillingSubscriptionStatus.EXPIRED:
      return 40;
    default:
      return 0;
  }
}

export function pickCurrentSubscription(subscriptions: BillingSubscription[]) {
  if (!subscriptions.length) return null;
  return [...subscriptions].sort((a, b) => {
    const priorityDelta = subscriptionPriority(b.status) - subscriptionPriority(a.status);
    if (priorityDelta !== 0) return priorityDelta;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0] ?? null;
}

function buildOffers(config: BillingConfig, enabled: boolean): BillingOffer[] {
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

function baseSummary(config: BillingConfig): BillingSummary {
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
    planCode: BillingPlanCode.EARLY_STAGE,
    subscriptionStatus: "active",
    accessLevel: "full",
    nextAction: config.checkoutReady ? "start_checkout" : "contact_support",
    isSuperAdminBypass: false,
    planEndsAt: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    canCancelCurrentSubscription: false,
    canReactivateCurrentSubscription: false,
    reactivationRequiresCard: false,
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

function withCurrentSubscription(summary: BillingSummary, subscription: BillingSubscription) {
  return {
    ...summary,
    planCode: subscription.planCode,
    planEndsAt: toIsoOrNull(subscription.currentPeriodEndsAt ?? subscription.trialEndsAt ?? subscription.endedAt),
    graceEndsAt: toIsoOrNull(subscription.graceEndsAt),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    canCancelCurrentSubscription:
      subscription.planCode === BillingPlanCode.PRO_MONTHLY &&
      subscription.status === BillingSubscriptionStatus.ACTIVE &&
      !subscription.cancelAtPeriodEnd,
    canReactivateCurrentSubscription: false,
    reactivationRequiresCard: false,
    price: {
      amountMinor: subscription.amountMinor,
      currencyCode: "USD" as const,
    },
  };
}

export function getPlanDurationMonths(planCode: BillingPlanCode) {
  if (planCode === BillingPlanCode.PRO_EARLY_ANNUAL) return 12;
  if (planCode === BillingPlanCode.PRO_MONTHLY) return 1;
  return 0;
}

function getEarlyStageDurationMonths(user: BillingUser, config: BillingConfig) {
  if (user.specialGuest) {
    return config.earlyStageSpecialGuestMonths;
  }
  return config.earlyStageMonths;
}

export function buildBillingSummary(user: BillingUser): BillingSummary {
  const config = getBillingConfig();
  const checkoutAllowed = isCheckoutAllowedForUser(config, user.email);
  const nextCheckoutAction: BillingNextAction = checkoutAllowed ? "start_checkout" : "contact_support";
  const summary = {
    ...baseSummary(config),
    offers: buildOffers(config, checkoutAllowed),
    nextAction: nextCheckoutAction,
  };
  const now = new Date();

  if (user.role === "SUPER_ADMIN") {
    return {
      ...summary,
      planCode: BillingPlanCode.LEGACY_FREE,
      subscriptionStatus: "active",
      accessLevel: "full",
      nextAction: "none",
      isSuperAdminBypass: true,
      offers: [],
      canCancelCurrentSubscription: false,
      canReactivateCurrentSubscription: false,
      reactivationRequiresCard: false,
      notes: ["super_admin_bypass"],
    };
  }

  const currentSubscription = pickCurrentSubscription(user.billingSubscriptions as BillingSubscription[]);
  if (currentSubscription) {
    const withSubscription = withCurrentSubscription(summary, currentSubscription);
    const offers = currentSubscription.status === BillingSubscriptionStatus.ACTIVE ? [] : summary.offers;

    switch (currentSubscription.status) {
      case BillingSubscriptionStatus.ACTIVE:
        return {
          ...withSubscription,
          subscriptionStatus: "active",
          accessLevel: "full",
          nextAction: "none",
          offers: [],
        };
      case BillingSubscriptionStatus.TRIALING:
        return {
          ...withSubscription,
          subscriptionStatus: "active",
          accessLevel: "full",
          nextAction: "none",
          offers,
          notes: ["paid_subscription_trialing"],
        };
      case BillingSubscriptionStatus.PAST_DUE: {
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
      case BillingSubscriptionStatus.CANCELED: {
        const stillInPeriod = !!currentSubscription.currentPeriodEndsAt && now <= currentSubscription.currentPeriodEndsAt;
        const hasSavedCard = !!currentSubscription.providerCardId;
        return {
          ...withSubscription,
          subscriptionStatus: "canceled",
          accessLevel: stillInPeriod ? "full" : "read_only",
          nextAction: stillInPeriod ? "manage_subscription" : "start_checkout",
          offers,
          canReactivateCurrentSubscription: stillInPeriod && currentSubscription.planCode === BillingPlanCode.PRO_MONTHLY,
          reactivationRequiresCard: stillInPeriod && currentSubscription.planCode === BillingPlanCode.PRO_MONTHLY && !hasSavedCard,
          notes: stillInPeriod ? ["canceled_end_of_period"] : ["canceled_period_ended"],
        };
      }
      case BillingSubscriptionStatus.INCOMPLETE:
        return {
          ...withSubscription,
          subscriptionStatus: "incomplete",
          accessLevel: "full",
          nextAction: checkoutAllowed ? "start_checkout" : "contact_support",
          offers,
          notes: ["subscription_incomplete"],
        };
      case BillingSubscriptionStatus.PAUSED:
        return {
          ...withSubscription,
          subscriptionStatus: "paused",
          accessLevel: "read_only",
          nextAction: "contact_support",
          offers,
          notes: ["subscription_paused"],
        };
      case BillingSubscriptionStatus.EXPIRED:
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

  const earlyStageEndsAt = addMonths(user.createdAt, getEarlyStageDurationMonths(user, config));
  const earlyStageExpired = now > earlyStageEndsAt;
  return {
    ...summary,
    planCode: BillingPlanCode.EARLY_STAGE,
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
