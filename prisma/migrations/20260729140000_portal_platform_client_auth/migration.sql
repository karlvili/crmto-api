-- CreateTable
CREATE TABLE "platforms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platforms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platforms_host_key" ON "platforms"("host");

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "phoneCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "clients" ADD COLUMN "password" TEXT;
ALTER TABLE "clients" ADD COLUMN "platformId" TEXT;
ALTER TABLE "clients" ADD COLUMN "registeredHost" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "clients_email_idx" ON "clients"("email");
CREATE INDEX "clients_platformId_idx" ON "clients"("platformId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
