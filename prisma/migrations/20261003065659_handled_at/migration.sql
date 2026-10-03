-- AlterTable
ALTER TABLE "SalesMessage" ADD COLUMN "handledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CeoMessage" ADD COLUMN "handledAt" TIMESTAMP(3);

-- Historical rows: treat as already handled (avoids a flood of retroactive
-- re-processing for conversations that were already resolved before this
-- column existed). Any genuinely stuck message is fixed manually alongside
-- this migration.
UPDATE "SalesMessage" SET "handledAt" = "createdAt" WHERE "handledAt" IS NULL;
UPDATE "CeoMessage" SET "handledAt" = "createdAt" WHERE "handledAt" IS NULL;
