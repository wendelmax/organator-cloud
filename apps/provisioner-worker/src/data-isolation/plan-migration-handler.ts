import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { resolvePlanSpec, calculatePlanDiff } from '@organator/data-isolation';

export async function handleReconcilePlanMigration(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, currentPlan, targetPlan } = job.data;
  const current = resolvePlanSpec(currentPlan);
  const target = resolvePlanSpec(targetPlan);
  const diffActions = calculatePlanDiff(current, target);

  for (const action of diffActions) {
    if (action.type === 'CHANGE_DATA_ISOLATION') {
      await prisma.tenantDataPlane.upsert({
        where: { tenantId },
        create: { tenantId, status: 'RECONCILING', phase: 'MIGRATING_DATA', activeIsolation: action.mode as any },
        update: { status: 'RECONCILING', phase: 'MIGRATING_DATA', activeIsolation: action.mode as any },
      });
    }
  }

  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'READY', phase: 'READY', completedAt: new Date() },
    update: { status: 'READY', phase: 'READY', completedAt: new Date() },
  });

  return { success: true };
}

export async function handleApplyDowngradeReconciliation(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { tenantId, targetPlan } = job.data;
  const target = resolvePlanSpec(targetPlan);

  await prisma.tenantDataPlane.upsert({
    where: { tenantId },
    create: { tenantId, status: 'READY', phase: 'READY', activeIsolation: target.isolationMode as any },
    update: { status: 'READY', phase: 'READY', activeIsolation: target.isolationMode as any },
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { graceEndsAt: null },
  });

  return { success: true };
}
