-- CreateTable
CREATE TABLE "SeoSite" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'sardor',
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoQuery" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'uz',
    "category" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankCheck" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'google',
    "position" INTEGER,
    "url" TEXT,
    "top" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoAudit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoSite_domain_key" ON "SeoSite"("domain");

-- CreateIndex
CREATE INDEX "SeoQuery_siteId_priority_idx" ON "SeoQuery"("siteId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SeoQuery_siteId_query_locale_key" ON "SeoQuery"("siteId", "query", "locale");

-- CreateIndex
CREATE INDEX "RankCheck_queryId_checkedAt_idx" ON "RankCheck"("queryId", "checkedAt");

-- CreateIndex
CREATE INDEX "SeoAudit_siteId_createdAt_idx" ON "SeoAudit"("siteId", "createdAt");

-- AddForeignKey
ALTER TABLE "SeoQuery" ADD CONSTRAINT "SeoQuery_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SeoSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheck" ADD CONSTRAINT "RankCheck_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "SeoQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoAudit" ADD CONSTRAINT "SeoAudit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SeoSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
