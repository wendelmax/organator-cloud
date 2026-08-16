import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { IsolationRepository } from './repository.js';
import { reconcileDataIsolation, ReconcilePayload } from './reconciler.js';
import { PostgresIsolationAdapter } from '@organator/data-isolation';
import { encryptSecret } from '@organator/cloud-providers';

export async function handleReconcileDataIsolation(
  job: Job<ReconcilePayload>,
  prisma: PrismaClient,
): Promise<{ success: boolean; status: string; message?: string }> {
  const repository = new IsolationRepository(prisma);

  const adapter = new PostgresIsolationAdapter({
    adminUrl: process.env.DATABASE_URL || 'postgresql://organator:password@localhost:5432/organator_db',
    storeConnection: async (input) => {
      const enc = encryptSecret(input.url);
      return {
        reference: { id: `${input.mode}:${input.tenantId}`, mode: input.mode },
        encryptedPayload: { url: enc },
      };
    },
  });

  try {
    const result = await reconcileDataIsolation(repository, adapter, job.data);
    return { success: result.status === 'SUCCESS', status: result.status, message: result.message };
  } finally {
    await adapter.close();
  }
}
