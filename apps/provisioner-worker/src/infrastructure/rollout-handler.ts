import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { evaluateCircuitState } from '@organator/data-isolation';

export async function handleDeployRollout(job: Job, prisma: PrismaClient): Promise<{ success: boolean }> {
  const { deploymentId, strategy } = job.data;
  const currentStrategy = strategy || 'REBUILD';

  if (deploymentId) {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { phase: 'SUCCESS', strategy: currentStrategy as any },
    });
  }

  return { success: true };
}
