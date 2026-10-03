-- Exportação do dataset de um tenant pelo admin da plataforma (#109). Aditiva.
-- AlterTable
ALTER TABLE "DataExport" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN     "tenantId" TEXT;

