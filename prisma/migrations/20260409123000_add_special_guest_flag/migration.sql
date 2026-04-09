ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "specialGuest" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" u
SET "specialGuest" = true
WHERE u."role" <> 'SUPER_ADMIN'
  AND u."createdAt" < TIMESTAMPTZ '2026-04-10 00:00:00-03:00'
  AND NOT EXISTS (
    SELECT 1
    FROM "BillingSubscription" bs
    WHERE bs."userId" = u."id"
  );
