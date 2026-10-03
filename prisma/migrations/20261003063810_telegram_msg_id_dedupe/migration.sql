-- AlterTable
ALTER TABLE "SalesMessage" ADD COLUMN "telegramMsgId" INTEGER;

-- AlterTable
ALTER TABLE "CeoMessage" ADD COLUMN "telegramMsgId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "SalesMessage_threadId_telegramMsgId_key" ON "SalesMessage"("threadId", "telegramMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "CeoMessage_contactId_telegramMsgId_key" ON "CeoMessage"("contactId", "telegramMsgId");
