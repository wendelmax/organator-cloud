import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import { handleReconcileDataIsolation } from './data-isolation/job-handler.js';

export interface WorkerDependencies {
  connection: { host: string; port: number };
  prisma: PrismaClient;
  redisPublisher: Redis;
  handlers?: Record<string, (job: Job) => Promise<any>>;
}

export function createProvisionerWorker(deps: WorkerDependencies): Worker {
  return new Worker(
    'provisioner',
    async (job: Job) => {
      if (job.name === 'reconcile-data-isolation') {
        const result = await handleReconcileDataIsolation(job, deps.prisma);
        if (!result.success && result.status === 'FAILED') {
          throw new Error(result.message || 'Data isolation reconciliation failed');
        }
        return result;
      }
      if (deps.handlers && deps.handlers[job.name]) {
        return deps.handlers[job.name](job);
      }
      return { success: true };
    },
    { connection: deps.connection },
  );
}
