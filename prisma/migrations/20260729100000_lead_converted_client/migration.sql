-- AlterTable
ALTER TABLE "leads" ADD COLUMN "convertedClientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_convertedClientId_key" ON "leads"("convertedClientId");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
