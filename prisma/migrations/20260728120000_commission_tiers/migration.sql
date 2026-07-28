-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "broughtById" TEXT;
ALTER TABLE "transactions" ADD COLUMN "commissionPct" DECIMAL(5,2);
ALTER TABLE "transactions" ADD COLUMN "commissionAmt" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "commission_tiers" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "minAmount" DECIMAL(18,2) NOT NULL,
    "maxAmount" DECIMAL(18,2),
    "percent" DECIMAL(5,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transactions_broughtById_idx" ON "transactions"("broughtById");
CREATE INDEX "commission_tiers_role_active_idx" ON "commission_tiers"("role", "active");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_broughtById_fkey" FOREIGN KEY ("broughtById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
