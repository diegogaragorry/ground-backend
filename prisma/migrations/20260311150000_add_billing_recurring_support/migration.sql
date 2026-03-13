ALTER TABLE "BillingSubscription"
ADD COLUMN IF NOT EXISTS "renewalLockedAt" TIMESTAMP(3);
