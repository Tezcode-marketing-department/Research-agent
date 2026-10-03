-- CreateTable
CREATE TABLE "CeoContact" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "telegramPeerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CeoContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CeoMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CeoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CeoContact_label_key" ON "CeoContact"("label");

-- CreateIndex
CREATE INDEX "CeoMessage_contactId_createdAt_idx" ON "CeoMessage"("contactId", "createdAt");

-- AddForeignKey
ALTER TABLE "CeoMessage" ADD CONSTRAINT "CeoMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CeoContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
