DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderChannel') THEN
    CREATE TYPE "ReminderChannel" AS ENUM ('NONE', 'EMAIL', 'SMS');
  END IF;
END $$;

ALTER TABLE "ExpenseTemplate"
ADD COLUMN IF NOT EXISTS "reminderChannel" "ReminderChannel" NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "dueDayOfMonth" INTEGER,
ADD COLUMN IF NOT EXISTS "remindDaysBefore" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlannedExpense"
ADD COLUMN IF NOT EXISTS "reminderChannel" "ReminderChannel" NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "remindAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "remindDaysBefore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reminderOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "emailReminderSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "smsReminderSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "reminderResolvedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PlannedExpense_remindAt_idx" ON "PlannedExpense"("remindAt");
CREATE INDEX IF NOT EXISTS "PlannedExpense_userId_remindAt_idx" ON "PlannedExpense"("userId", "remindAt");
