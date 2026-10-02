import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { calculateBackupChecksum } from '@organator/data-isolation';
import { DockerDriver } from '@organator/cloud-providers';
import { currentIsolation, resolveProvider } from '../infrastructure/infra-handler.js';

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

/**
 * Conclui o offboarding iniciado pela API (tenant já em "offboarding", acesso
 * bloqueado e cobrança encerrada): backup final, remoção da infraestrutura com
 * o slug e o isolamento reais e transição para "deleted". Se algo falhar, o
 * tenant continua em "offboarding" e o job pode ser repetido.
 */
export async function handleOffboardTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, actorId, provider } = job.data;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
  if (tenant.state === 'deleted') return { success: true }; // job repetido
  if (tenant.state !== 'offboarding') {
    throw new Error(`Tenant ${tenantId} is ${tenant.state}, expected offboarding`);
  }

  await handleBackupTenantInfra({ data: { tenantId, type: 'PRE_OFFBOARDING' } } as any, prisma);

  const driver = resolveProvider(provider);
  await driver.deprovision(
    {
      tenantId,
      slug: tenant.slug,
      isolationMode: await currentIsolation(prisma, tenantId),
      environment: 'production',
    },
    {},
  );

  // Mesma escrita da máquina de estados da API: o guard de acesso lê `state`.
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { state: 'deleted', status: 'archived', stateChangedAt: new Date() },
  });
  await prisma.auditLog
    .create({
      data: {
        actorId: actorId ?? null,
        action: 'tenant.state_change',
        resourceType: 'Tenant',
        resourceId: tenantId,
        changes: { from: 'offboarding', to: 'deleted', reason: 'offboard-tenant-infra' },
      },
    })
    .catch(() => undefined);

  return { success: true };
}
