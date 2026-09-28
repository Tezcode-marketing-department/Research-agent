-- CreateTable
CREATE TABLE "ChatTurn" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatTurn_agent_chatId_createdAt_idx" ON "ChatTurn"("agent", "chatId", "createdAt");
