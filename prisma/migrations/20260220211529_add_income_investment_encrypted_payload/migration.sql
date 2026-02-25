-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "encryptedPayload" TEXT;

-- AlterTable
ALTER TABLE "InvestmentMovement" ADD COLUMN     "encryptedPayload" TEXT;

-- AlterTable
ALTER TABLE "InvestmentSnapshot" ADD COLUMN     "encryptedPayload" TEXT;
