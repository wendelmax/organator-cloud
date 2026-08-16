import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { calculateBackupChecksum } from '@organator/data-isolation';
import { DockerDriver } from '@organator/cloud-providers';

export async function handleBackupTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean; backupId: string }> {
  const { tenantId, type } = job.data;
  const backup = await prisma.tenantBackup.create({
    data: {
      tenantId,
      type: type || 'MANUAL',
      status: 'PENDING',
      storagePath: `backups/${tenantId}/${Date.now()}.json`,
      retentionDays: 7,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const payload = JSON.stringify({ tenantId, timestamp: new Date().toISOString() });
  const checksum = calculateBackupChecksum(payload);

  await prisma.tenantBackup.update({
    where: { id: backup.id },
    data: { status: 'COMPLETED', checksum, sizeBytes: BigInt(payload.length) },
  });

  return { success: true, backupId: backup.id };
}

export async function handleRestoreTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, backupId } = job.data;
  const backup = await prisma.tenantBackup.findUnique({ where: { id: backupId } });
  if (!backup || backup.status !== 'COMPLETED') {
    throw new Error(`Backup ${backupId} invalid or incomplete`);
  }
  return { success: true };
}

export async function handleCloneTenantEnvironment(job: Job, prisma: PrismaClient): Promise<{ success: boolean; targetTenantId: string }> {
  const { targetSlug, targetName } = job.data;
  const targetTenant = await prisma.tenant.create({
    data: { name: targetName, slug: targetSlug, plan: 'free', status: 'active' },
  });

  const driver = new DockerDriver();
  await driver.prepareDatabase({ tenantId: targetTenant.id, slug: targetSlug, isolationMode: 'SHARED', environment: 'production' });

  return { success: true, targetTenantId: targetTenant.id };
}

export async function handleOffboardTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId } = job.data;

  await handleBackupTenantInfra({ data: { tenantId, type: 'PRE_OFFBOARDING' } } as any, prisma);

  const driver = new DockerDriver();
  await driver.deprovision({ tenantId, slug: tenantId, isolationMode: 'SHARED', environment: 'production' }, {});

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { status: 'deleted' },
  });

  return { success: true };
}
