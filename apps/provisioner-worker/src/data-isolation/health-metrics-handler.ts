import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
export async function handlePromoteTenantEnvironment(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, sourceEnvId } = job.data;
  const sourceEnv = await prisma.tenantEnvironment.findUnique({ where: { id: sourceEnvId } });
  if (!sourceEnv) throw new Error('Source environment not found');

  await prisma.tenantEnvironment.upsert({
    where: { tenantId_type: { tenantId, type: 'PRODUCTION' } },
    create: { tenantId, name: 'Production', type: 'PRODUCTION', envVars: sourceEnv.envVars as any, isPromoted: true },
    update: { envVars: sourceEnv.envVars as any, isPromoted: true },
  });

  return { success: true };
}
