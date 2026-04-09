import { Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "./requireAuth";
import { buildBillingSummary } from "../billing/billing.service";

export async function requireBillingWriteAccess(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      specialGuest: true,
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

  const billing = buildBillingSummary(user);
  if (billing.accessLevel === "full") {
    return next();
  }

  return res.status(402).json({
    error: "Billing required to modify data",
    code: "billing_write_locked",
    billing,
  });
}
