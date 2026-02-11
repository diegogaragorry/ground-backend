-- Add preferred display currency for user (USD or UYU for showing totals/summaries)
ALTER TABLE "User" ADD COLUMN "preferredDisplayCurrencyId" TEXT;
