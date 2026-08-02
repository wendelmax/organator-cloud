import { PrismaService } from '../prisma/prisma.service';

/**
 * Extrai o tenantId de uma requisição, na ordem:
 * 1. req.user.tenantId (JWT)
 * 2. req.body.tenantId
 * 3. req.params.tenantId
 * 4. Tenant dono do microservice em req.params.id (ex.: POST /v1/services/:id/deploy)
 */
export async function extractTenantId(
  req: any,
  prisma: PrismaService,
): Promise<string | undefined> {
  let tenantId =
    req.user?.tenantId || req.body?.tenantId || req.params?.tenantId;

  if (!tenantId && req.params?.id) {
    const service = await prisma.microservice.findUnique({
      where: { id: req.params.id },
      select: { tenantId: true },
    });
    if (service) {
      tenantId = service.tenantId;
    }
  }

  return tenantId;
}
