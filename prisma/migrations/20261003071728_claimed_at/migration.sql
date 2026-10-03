-- AlterTable
ALTER TABLE "SalesMessage" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CeoMessage" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- Historical rows are already handled (set in the previous migration);
-- nothing to backfill here — claimedAt stays null for them, which is fine
-- since handledAt already marks them complete.
