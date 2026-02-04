/*
  Warnings:

  - You are about to drop the column `closingCapital` on the `InvestmentSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `closingCapitalUsd` on the `InvestmentSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `usdUyuRate` on the `InvestmentSnapshot` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `InvestmentSnapshot` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[investmentId,year,month]` on the table `InvestmentSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "InvestmentSnapshot" DROP CONSTRAINT "InvestmentSnapshot_investmentId_fkey";

-- DropIndex
DROP INDEX "InvestmentSnapshot_userId_investmentId_year_month_key";

-- AlterTable
ALTER TABLE "InvestmentSnapshot" DROP COLUMN "closingCapital",
DROP COLUMN "closingCapitalUsd",
DROP COLUMN "usdUyuRate",
DROP COLUMN "userId",
ADD COLUMN     "capital" DOUBLE PRECISION,
ADD COLUMN     "capitalUsd" DOUBLE PRECISION,
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "InvestmentSnapshot_year_month_idx" ON "InvestmentSnapshot"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentSnapshot_investmentId_year_month_key" ON "InvestmentSnapshot"("investmentId", "year", "month");

-- AddForeignKey
ALTER TABLE "InvestmentSnapshot" ADD CONSTRAINT "InvestmentSnapshot_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
