-- CreateTable
CREATE TABLE "SeoPage" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "h1" TEXT,
    "h2" TEXT,
    "lang" TEXT,
    "words" INTEGER NOT NULL DEFAULT 0,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "source" TEXT NOT NULL DEFAULT 'havola',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeoPage_siteId_idx" ON "SeoPage"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SeoPage_siteId_url_key" ON "SeoPage"("siteId", "url");

-- AddForeignKey
ALTER TABLE "SeoPage" ADD CONSTRAINT "SeoPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SeoSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
