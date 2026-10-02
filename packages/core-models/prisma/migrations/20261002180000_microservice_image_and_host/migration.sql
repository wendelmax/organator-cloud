-- Imagem Docker e destino (user@host) do deploy em VPS.
ALTER TABLE "Microservice" ADD COLUMN     "image" TEXT,
ADD COLUMN     "vpsHost" TEXT;
