-- AlterTable
ALTER TABLE "ExpenseTemplate" ADD COLUMN IF NOT EXISTS "defaultCurrencyId" TEXT DEFAULT 'USD';
