-- CreateTable
CREATE TABLE "SalesThread" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "telegramPeerId" TEXT,
    "exchangeCount" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'open',
    "proposedTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesThread_leadId_key" ON "SalesThread"("leadId");

-- CreateIndex
CREATE INDEX "SalesMessage_threadId_createdAt_idx" ON "SalesMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "SalesThread" ADD CONSTRAINT "SalesThread_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMessage" ADD CONSTRAINT "SalesMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SalesThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
