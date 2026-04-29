UPDATE "Expense" AS e
SET "expenseType" = c."expenseType"
FROM "Category" AS c
WHERE e."categoryId" = c."id"
  AND e."expenseType" <> c."expenseType";
