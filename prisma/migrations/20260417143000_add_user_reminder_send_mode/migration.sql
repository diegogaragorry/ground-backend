DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderSendMode') THEN
    CREATE TYPE "ReminderSendMode" AS ENUM ('ONCE', 'DAILY_UNTIL_PAID');
  END IF;
END $$;

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "expenseReminderSendMode" "ReminderSendMode" NOT NULL DEFAULT 'ONCE';
