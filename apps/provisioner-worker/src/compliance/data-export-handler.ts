import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';

/** Por quanto tempo o arquivo fica disponível para download. */
export const EXPORT_TTL_DAYS = 7;

/**
 * Dados pessoais do titular em formato legível (LGPD art. 18-V, #109).
 * Nunca inclui segredos: hash de senha, segredo de MFA, hashes de tokens,
 * de sessões ou de API keys.
 */
export async function buildUserExport(
  prisma: PrismaClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      authProvider: true,
      mfaEnabled: true,
      createdAt: true,
      updatedAt: true,
      passwordChangedAt: true,
      tenant: { select: { id: true, name: true, slug: true, plan: true } },
    },
  });
  if (!user) throw new Error(`User ${userId} not found`);

  const [memberships, sessions, apiKeys, invitations, activity] = await Promise.all([
    prisma.tenantMembership.findMany({
      where: { userId },
      select: {
        role: true,
        status: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        ip: true,
        userAgent: true,
        tenantId: true,
      },
    }),
    prisma.apiKey.findMany({
      where: { createdBy: userId },
      select: {
        name: true,
        prefix: true,
        scopes: true,
        tenantId: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    }),
    prisma.tenantInvitation.findMany({
      where: { email: user.email },
      select: {
        role: true,
        createdAt: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        tenant: { select: { name: true, slug: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        action: true,
        resourceType: true,
        resourceId: true,
        ip: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    format: 'organator.user-export.v1',
    generatedAt: new Date().toISOString(),
    profile: user,
    memberships,
    sessions,
    apiKeys,
    invitations,
    activity,
  };
}

/** Job `generate-data-export`: gera o arquivo e o deixa pronto por EXPORT_TTL_DAYS. */
export async function handleGenerateDataExport(job: Job, prisma: PrismaClient) {
  const { exportId } = job.data;
  const request = await prisma.dataExport.findUnique({ where: { id: exportId } });
  if (!request) throw new Error(`Data export ${exportId} not found`);
  if (request.status !== 'PENDING') return { success: true }; // job repetido

  try {
    const content = await buildUserExport(prisma, request.userId);
    const now = new Date();
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: 'READY',
        content: content as any,
        completedAt: now,
        expiresAt: new Date(now.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    return { success: true };
  } catch (err) {
    await prisma.dataExport.update({
      where: { id: exportId },
      data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}
