ALTER TABLE "Investment"
ADD COLUMN IF NOT EXISTS "onboardingSourceKey" TEXT;

ALTER TABLE "InvestmentMovement"
ADD COLUMN IF NOT EXISTS "onboardingSourceKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Investment_userId_onboardingSourceKey_key"
ON "Investment"("userId", "onboardingSourceKey");

CREATE INDEX IF NOT EXISTS "Investment_userId_onboardingSourceKey_idx"
ON "Investment"("userId", "onboardingSourceKey");

CREATE UNIQUE INDEX IF NOT EXISTS "InvestmentMovement_investmentId_onboardingSourceKey_key"
ON "InvestmentMovement"("investmentId", "onboardingSourceKey");

CREATE INDEX IF NOT EXISTS "InvestmentMovement_investmentId_onboardingSourceKey_idx"
ON "InvestmentMovement"("investmentId", "onboardingSourceKey");
