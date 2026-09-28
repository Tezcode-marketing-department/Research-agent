-- CreateTable
CREATE TABLE "SeoTask" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "target" TEXT,
    "impact" INTEGER NOT NULL DEFAULT 3,
    "effort" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'open',
    "owner" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "SeoTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoTask_siteId_status_idx" ON "SeoTask"("siteId", "status");

-- AddForeignKey
ALTER TABLE "SeoTask" ADD CONSTRAINT "SeoTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SeoSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
