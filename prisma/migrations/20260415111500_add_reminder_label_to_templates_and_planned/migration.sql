ALTER TABLE "ExpenseTemplate"
ADD COLUMN "reminderLabel" TEXT;

ALTER TABLE "PlannedExpense"
ADD COLUMN "reminderLabel" TEXT;

UPDATE "ExpenseTemplate"
SET "reminderLabel" = "description"
WHERE "reminderLabel" IS NULL
  AND "description" IS NOT NULL
  AND "description" !~ '^\(encrypted(?:-[a-z0-9]{8})?\)$';

UPDATE "PlannedExpense"
SET "reminderLabel" = "description"
WHERE "reminderLabel" IS NULL
  AND "description" IS NOT NULL
  AND "description" !~ '^\(encrypted(?:-[a-z0-9]{8})?\)$';
