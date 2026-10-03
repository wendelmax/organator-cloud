-- Sessões de impersonação para suporte (#103). Aditiva.
-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "impersonationReason" TEXT,
ADD COLUMN     "impersonatorEmail" TEXT,
ADD COLUMN     "impersonatorId" TEXT;

