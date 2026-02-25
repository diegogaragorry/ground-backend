-- AlterTable
ALTER TABLE "ExpenseTemplate" ADD COLUMN     "encryptedPayload" TEXT;

-- AlterTable
ALTER TABLE "MonthClose" ADD COLUMN     "encryptedPayload" TEXT;

-- AlterTable
ALTER TABLE "MonthlyBudget" ADD COLUMN     "encryptedPayload" TEXT;

-- AlterTable
ALTER TABLE "PlannedExpense" ADD COLUMN     "encryptedPayload" TEXT;
