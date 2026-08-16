import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { evaluateHealthStatus } from '@organator/data-isolation';

export async function handleCollectTenantMetrics(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId } = job.data;
  const status = evaluateHealthStatus({ db: 'HEALTHY', network: 'HEALTHY', dns: 'HEALTHY' });

  await prisma.tenantHealth.create({
    data: {
      tenantId,
      status,
      dbStatus: 'HEALTHY',
      networkStatus: 'HEALTHY',
      dnsStatus: 'HEALTHY',
      cpuUsagePct: 15.5,
      memoryUsageMb: 256.0,
      storageUsageMb: 512.0,
      activeRequests: 42,
    },
  });

  return { success: true };
}

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
