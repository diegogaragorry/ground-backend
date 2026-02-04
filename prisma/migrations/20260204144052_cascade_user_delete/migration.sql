-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_userId_fkey";

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_userId_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_userId_fkey";

-- DropForeignKey
ALTER TABLE "ExpensePlan" DROP CONSTRAINT "ExpensePlan_userId_fkey";

-- DropForeignKey
ALTER TABLE "ExpenseTemplate" DROP CONSTRAINT "ExpenseTemplate_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "ExpenseTemplate" DROP CONSTRAINT "ExpenseTemplate_userId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_userId_fkey";

-- DropForeignKey
ALTER TABLE "Investment" DROP CONSTRAINT "Investment_userId_fkey";

-- DropForeignKey
ALTER TABLE "InvestmentMovement" DROP CONSTRAINT "InvestmentMovement_investmentId_fkey";

-- DropForeignKey
ALTER TABLE "MonthClose" DROP CONSTRAINT "MonthClose_userId_fkey";

-- DropForeignKey
ALTER TABLE "MonthlyBudget" DROP CONSTRAINT "MonthlyBudget_userId_fkey";

-- DropForeignKey
ALTER TABLE "Period" DROP CONSTRAINT "Period_userId_fkey";

-- DropForeignKey
ALTER TABLE "PlannedExpense" DROP CONSTRAINT "PlannedExpense_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "PlannedExpense" DROP CONSTRAINT "PlannedExpense_userId_fkey";

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentMovement" ADD CONSTRAINT "InvestmentMovement_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Period" ADD CONSTRAINT "Period_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpensePlan" ADD CONSTRAINT "ExpensePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthClose" ADD CONSTRAINT "MonthClose_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseTemplate" ADD CONSTRAINT "ExpenseTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedExpense" ADD CONSTRAINT "PlannedExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
