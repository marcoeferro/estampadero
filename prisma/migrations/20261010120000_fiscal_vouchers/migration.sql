-- CreateEnum
CREATE TYPE "TaxCondition" AS ENUM ('CONSUMIDOR_FINAL', 'RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO');

-- CreateEnum
CREATE TYPE "FiscalVoucherKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "FiscalVoucherStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_AUTHORIZATION', 'ISSUED', 'FAILED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerLegalName" TEXT,
ADD COLUMN     "customerTaxCondition" "TaxCondition",
ADD COLUMN     "customerTaxId" TEXT;

-- CreateTable
CREATE TABLE "FiscalVoucher" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "FiscalVoucherKind" NOT NULL,
    "voucherType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "FiscalVoucherStatus" NOT NULL DEFAULT 'PENDING',
    "amountInCents" INTEGER NOT NULL,
    "netAmountInCents" INTEGER NOT NULL,
    "vatAmountInCents" INTEGER NOT NULL,
    "buyerDocType" TEXT NOT NULL,
    "buyerDocNumber" TEXT NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerTaxCondition" "TaxCondition" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVoucherId" TEXT,
    "pointOfSale" INTEGER,
    "number" INTEGER,
    "cae" TEXT,
    "caeExpiresAt" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "issuedAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,
    "relatedVoucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FiscalVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalVoucher_idempotencyKey_key" ON "FiscalVoucher"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FiscalVoucher_orderId_idx" ON "FiscalVoucher"("orderId");

-- CreateIndex
CREATE INDEX "FiscalVoucher_status_nextAttemptAt_idx" ON "FiscalVoucher"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FiscalVoucher_providerVoucherId_idx" ON "FiscalVoucher"("providerVoucherId");

-- CreateIndex
CREATE INDEX "FiscalVoucher_createdAt_idx" ON "FiscalVoucher"("createdAt");

-- AddForeignKey
ALTER TABLE "FiscalVoucher" ADD CONSTRAINT "FiscalVoucher_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalVoucher" ADD CONSTRAINT "FiscalVoucher_relatedVoucherId_fkey" FOREIGN KEY ("relatedVoucherId") REFERENCES "FiscalVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
