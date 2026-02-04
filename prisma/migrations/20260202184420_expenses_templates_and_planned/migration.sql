/*
  Warnings:

  - A unique constraint covering the columns `[userId,name]` on the table `Category` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[plannedExpenseId]` on the table `Expense` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('FIXED', 'VARIABLE');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "expenseType" "ExpenseType" NOT NULL DEFAULT 'VARIABLE';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "expenseType" "ExpenseType" NOT NULL DEFAULT 'VARIABLE',
ADD COLUMN     "plannedExpenseId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expenseType" "ExpenseType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "defaultAmountUsd" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "templateId" TEXT,
    "expenseType" "ExpenseType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseTemplate_userId_idx" ON "ExpenseTemplate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseTemplate_userId_expenseType_categoryId_description_key" ON "ExpenseTemplate"("userId", "expenseType", "categoryId", "description");

-- CreateIndex
CREATE INDEX "PlannedExpense_userId_year_month_idx" ON "PlannedExpense"("userId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PlannedExpense_userId_year_month_templateId_key" ON "PlannedExpense"("userId", "year", "month", "templateId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_name_key" ON "Category"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_plannedExpenseId_key" ON "Expense"("plannedExpenseId");

-- CreateIndex
CREATE INDEX "Expense_userId_date_idx" ON "Expense"("userId", "date");

-- CreateIndex
CREATE INDEX "Expense_userId_categoryId_idx" ON "Expense"("userId", "categoryId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_plannedExpenseId_fkey" FOREIGN KEY ("plannedExpenseId") REFERENCES "PlannedExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ExpenseTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
