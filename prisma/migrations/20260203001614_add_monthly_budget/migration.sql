/*
  Warnings:

  - You are about to drop the column `otherExpensesUsd` on the `Budget` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Budget" DROP COLUMN "otherExpensesUsd";

-- CreateTable
CREATE TABLE "MonthlyBudget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "otherExpensesUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyBudget_year_month_idx" ON "MonthlyBudget"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBudget_userId_year_month_key" ON "MonthlyBudget"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
