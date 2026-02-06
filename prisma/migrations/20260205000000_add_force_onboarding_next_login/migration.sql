-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "forceOnboardingNextLogin" BOOLEAN NOT NULL DEFAULT false;
