/*
  Warnings:

  - You are about to drop the column `amount` on the `Income` table. All the data in the column will be lost.
  - You are about to drop the column `source` on the `Income` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,year,month]` on the table `Income` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_currencyId_fkey";

-- DropIndex
DROP INDEX "Income_userId_year_month_idx";

-- AlterTable
ALTER TABLE "Income" DROP COLUMN "amount",
DROP COLUMN "source",
ALTER COLUMN "currencyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ExpensePlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpensePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpensePlan_year_month_idx" ON "ExpensePlan"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePlan_userId_year_month_key" ON "ExpensePlan"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "Income_year_month_idx" ON "Income"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Income_userId_year_month_key" ON "Income"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePlan" ADD CONSTRAINT "ExpensePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
