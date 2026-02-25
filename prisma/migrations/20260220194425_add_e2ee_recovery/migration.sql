-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedRecoveryPackage" TEXT,
ADD COLUMN     "encryptionSalt" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhoneVerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "PhoneVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoverySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailCodeHash" TEXT NOT NULL,
    "phoneCodeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" VARCHAR(500),

    CONSTRAINT "RecoverySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhoneVerificationCode_userId_idx" ON "PhoneVerificationCode"("userId");

-- CreateIndex
CREATE INDEX "PhoneVerificationCode_expiresAt_idx" ON "PhoneVerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "RecoverySession_userId_idx" ON "RecoverySession"("userId");

-- CreateIndex
CREATE INDEX "RecoverySession_expiresAt_idx" ON "RecoverySession"("expiresAt");

-- CreateIndex
CREATE INDEX "RecoveryToken_userId_idx" ON "RecoveryToken"("userId");

-- CreateIndex
CREATE INDEX "RecoveryToken_expiresAt_idx" ON "RecoveryToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PhoneVerificationCode" ADD CONSTRAINT "PhoneVerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoverySession" ADD CONSTRAINT "RecoverySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
