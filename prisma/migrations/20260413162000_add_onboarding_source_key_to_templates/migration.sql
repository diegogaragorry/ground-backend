ALTER TABLE "ExpenseTemplate"
ADD COLUMN IF NOT EXISTS "onboardingSourceKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseTemplate_userId_onboardingSourceKey_key"
ON "ExpenseTemplate"("userId", "onboardingSourceKey");

CREATE INDEX IF NOT EXISTS "ExpenseTemplate_userId_onboardingSourceKey_idx"
ON "ExpenseTemplate"("userId", "onboardingSourceKey");
