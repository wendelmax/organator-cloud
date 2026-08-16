import { PrismaClient } from '@organator/core-models';
import { decryptSecret } from '@organator/cloud-providers';
import { IsolationError } from '@organator/data-isolation';

export async function resolveDataPlaneConnection(
  prisma: PrismaClient,
  ref: { tenantId: string; generation: number; referenceId: string },
): Promise<string> {
  const dataPlane = await prisma.tenantDataPlane.findUnique({
    where: { tenantId: ref.tenantId },
  });

  if (!dataPlane) {
    throw new IsolationError('ISOLATION_CONNECTION_STALE', 'Data plane not found for tenant');
  }

  if (dataPlane.status !== 'READY') {
    throw new IsolationError('ISOLATION_CONNECTION_STALE', 'Data plane is not READY');
  }

  if (dataPlane.observedGeneration !== ref.generation) {
    throw new IsolationError('ISOLATION_CONNECTION_STALE', 'Generation mismatch');
  }

  const resourceState = (dataPlane.resourceState as Record<string, unknown>) || {};
  if (resourceState.activeConnectionReference !== ref.referenceId) {
    throw new IsolationError('ISOLATION_CONNECTION_STALE', 'Active connection reference mismatch');
  }

  const enc = dataPlane.encryptedConnection as Record<string, string> | null;
  if (!enc || !enc.url) {
    throw new IsolationError('ISOLATION_CONNECTION_STALE', 'Encrypted connection payload missing');
  }

  return decryptSecret(enc.url);
}
