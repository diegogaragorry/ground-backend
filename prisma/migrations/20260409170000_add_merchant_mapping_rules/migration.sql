-- CreateTable
CREATE TABLE "MerchantMappingRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "merchantFingerprint" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "expenseType" "ExpenseType" NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "lastLearnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantMappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantMappingRule_userId_merchantFingerprint_key" ON "MerchantMappingRule"("userId", "merchantFingerprint");

-- CreateIndex
CREATE INDEX "MerchantMappingRule_userId_updatedAt_idx" ON "MerchantMappingRule"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "MerchantMappingRule_userId_categoryId_idx" ON "MerchantMappingRule"("userId", "categoryId");

-- AddForeignKey
ALTER TABLE "MerchantMappingRule" ADD CONSTRAINT "MerchantMappingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantMappingRule" ADD CONSTRAINT "MerchantMappingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
