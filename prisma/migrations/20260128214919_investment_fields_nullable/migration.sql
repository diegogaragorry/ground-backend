/*
  Warnings:

  - Made the column `amountUsd` on table `Expense` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "amountUsd" SET NOT NULL;

-- AlterTable
ALTER TABLE "Investment" ADD COLUMN     "currencyId" TEXT,
ADD COLUMN     "targetAnnualReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "yieldStartMonth" INTEGER,
ADD COLUMN     "yieldStartYear" INTEGER;

-- CreateTable
CREATE TABLE "InvestmentSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closingCapital" DOUBLE PRECISION NOT NULL,
    "closingCapitalUsd" DOUBLE PRECISION NOT NULL,
    "usdUyuRate" DOUBLE PRECISION,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentSnapshot_userId_investmentId_year_month_key" ON "InvestmentSnapshot"("userId", "investmentId", "year", "month");

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentSnapshot" ADD CONSTRAINT "InvestmentSnapshot_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
