-- Registro de conformidade do direito ao esquecimento (#108). Aditiva.
-- CreateTable
CREATE TABLE "ErasureRecord" (
    "id" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "requestedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'subject_request',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErasureRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureRecord_subjectHash_idx" ON "ErasureRecord"("subjectHash");

