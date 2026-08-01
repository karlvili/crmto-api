-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('ID / Passport', 'Bank Statement');

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "KycDocType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_documents_clientId_idx" ON "kyc_documents"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_clientId_type_key" ON "kyc_documents"("clientId", "type");

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
