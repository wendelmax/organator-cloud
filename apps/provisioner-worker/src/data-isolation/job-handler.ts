import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import { IsolationRepository } from './repository.js';
import { reconcileDataIsolation, ReconcilePayload } from './reconciler.js';
import { PostgresIsolationAdapter } from '@organator/data-isolation';
import { encryptSecret } from '@organator/cloud-providers';
import { buildManifest, DataIsolationConfig, loadDataIsolationConfig } from './config.js';

export async function handleReconcileDataIsolation(
  job: Job<ReconcilePayload>,
  prisma: PrismaClient,
  config: DataIsolationConfig = loadDataIsolationConfig(),
): Promise<{ success: boolean; status: string; message?: string }> {
  // Desligado: não toca em nenhum banco (nem no do control plane).
  if (!config.enabled) {
    return { success: true, status: 'SKIPPED', message: 'Data isolation is disabled (DATA_ISOLATION_ENABLED != true)' };
  }

  const repository = new IsolationRepository(prisma);
  const adapter = new PostgresIsolationAdapter({
    adminUrl: config.adminUrl,
    rollbackHours: config.rollbackHours,
    storeConnection: async (input) => ({
      reference: { id: `${input.mode}:${input.tenantId}`, mode: input.mode },
      encryptedPayload: { url: encryptSecret(input.url) },
    }),
  });

  try {
    const result = await reconcileDataIsolation(repository, adapter, job.data, buildManifest(config.tables));
    return { success: result.status === 'SUCCESS', status: result.status, message: result.message };
  } finally {
    await adapter.close();
  }
}
