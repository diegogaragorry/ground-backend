"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireBillingWriteAccess = requireBillingWriteAccess;
const prisma_1 = require("../lib/prisma");
const billing_service_1 = require("../billing/billing.service");
async function requireBillingWriteAccess(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }
    const userId = req.userId;
    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
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
                    createdAt: true,
                    updatedAt: true,
                },
            },
        },
    });
    if (!user) {
        return res.status(401).json({ error: "User not found" });
    }
    const billing = (0, billing_service_1.buildBillingSummary)(user);
    if (billing.accessLevel === "full") {
        return next();
    }
    return res.status(402).json({
        error: "Billing required to modify data",
        code: "billing_write_locked",
        billing,
    });
}
