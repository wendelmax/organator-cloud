import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import {
  InfrastructureProvider,
  DockerDriver,
  AWSDriver,
  TerraformDriver,
  encryptSecret,
} from '@organator/cloud-providers';

export function resolveProvider(providerName?: string): InfrastructureProvider {
  switch ((providerName || '').toUpperCase()) {
    case 'AWS': return new AWSDriver();
    case 'TERRAFORM': return new TerraformDriver();
    default: return new DockerDriver();
  }
}

export async function handleDeployTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, slug, plan, provider } = job.data;
  const driver = resolveProvider(provider);

  const spec = {
    tenantId,
    slug: slug || tenantId,
    isolationMode: (plan === 'Enterprise' ? 'DATABASE' : plan === 'Pro' ? 'SCHEMA' : 'SHARED') as any,
    environment: 'production',
  };

  // Phase 1: DB
  const db = await driver.prepareDatabase(spec);
  const encryptedUrl = encryptSecret(db.connectionUrl);
  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'RECONCILING', phase: 'DB', encryptedConnection: { url: encryptedUrl } as any },
    update: { phase: 'DB', encryptedConnection: { url: encryptedUrl } as any },
  });

  // Phase 2: NETWORK
  await driver.prepareNetwork(spec);
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { phase: 'NETWORK' },
  });

  // Phase 3: DNS
  await driver.configureDNS(spec);
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { phase: 'DNS' },
  });

  // Phase 4: DONE
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { status: 'READY', phase: 'DONE', completedAt: new Date() },
  });

  return { success: true };
}

export async function handleDeprovisionTenantInfra(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, slug, provider } = job.data;
  const driver = resolveProvider(provider);
  const spec = { tenantId, slug: slug || tenantId, isolationMode: 'SHARED' as any, environment: 'production' };
  await driver.deprovision(spec, {});
  await prisma.tenantDataPlane.update({
    where: { tenantId },
    data: { status: 'PENDING', phase: 'PREPARE', activeIsolation: null },
  });
  return { success: true };
}
