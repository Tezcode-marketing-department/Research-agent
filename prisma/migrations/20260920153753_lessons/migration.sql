-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "evidence" TEXT,
    "source" TEXT NOT NULL DEFAULT 'sardor',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blocker" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "need" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Blocker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lesson_scope_active_idx" ON "Lesson"("scope", "active");

-- CreateIndex
CREATE INDEX "Blocker_status_agent_idx" ON "Blocker"("status", "agent");
