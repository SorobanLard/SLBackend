-- CreateTable
CREATE TABLE "course_search_terms" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "lastSearchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_search_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_search_terms_term_key" ON "course_search_terms"("term");

-- CreateIndex
CREATE INDEX "course_search_terms_searchCount_idx" ON "course_search_terms"("searchCount");

-- CreateIndex
CREATE INDEX "course_search_terms_lastSearchedAt_idx" ON "course_search_terms"("lastSearchedAt");

-- CreateIndex
-- Composite index supporting the Postgres-side structured filters used by the
-- course search path (category, price range, instructor, published status).
CREATE INDEX "Course_published_category_instructorId_price_idx" ON "Course"("published", "category", "instructorId", "price");
