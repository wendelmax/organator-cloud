import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import { handleReconcileDataIsolation } from './data-isolation/job-handler.js';

export interface WorkerDependencies {
  connection: { host: string; port: number };
  prisma: PrismaClient;
  redisPublisher: Redis;
  handlers?: Record<string, (job: Job) => Promise<any>>;
  reconcileDataIsolation?: typeof handleReconcileDataIsolation;
}

/** Roteia cada job da fila 'provisioner' para o handler correspondente. */
export function createJobProcessor(deps: Pick<WorkerDependencies, 'prisma' | 'handlers' | 'reconcileDataIsolation'>) {
  const reconcile = deps.reconcileDataIsolation ?? handleReconcileDataIsolation;
  return async (job: Job) => {
    if (job.name === 'reconcile-data-isolation') {
      const result = await reconcile(job, deps.prisma);
      if (!result.success && result.status === 'FAILED') {
        throw new Error(result.message || 'Data isolation reconciliation failed');
      }
      return result;
    }
    if (deps.handlers && deps.handlers[job.name]) {
      return deps.handlers[job.name](job);
    }
    return { success: true };
  };
}

export function createProvisionerWorker(deps: WorkerDependencies): Worker {
  return new Worker('provisioner', createJobProcessor(deps), { connection: deps.connection });
}
