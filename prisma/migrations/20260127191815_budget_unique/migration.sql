/*
  Warnings:

  - A unique constraint covering the columns `[userId,year,month,categoryId,currencyId]` on the table `Budget` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_year_month_categoryId_currencyId_key" ON "Budget"("userId", "year", "month", "categoryId", "currencyId");
