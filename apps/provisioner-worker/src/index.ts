import { Job } from 'bullmq';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import { createProvisionerWorker } from './worker.js';
import { startMetricsServer } from './data-isolation/metrics-server.js';
import { handleDeployTenantInfra, handleDeprovisionTenantInfra } from './infrastructure/infra-handler.js';
import { handleReconcilePlanMigration, handleApplyDowngradeReconciliation } from './data-isolation/plan-migration-handler.js';
import { handleBackupTenantInfra, handleRestoreTenantInfra, handleCloneTenantEnvironment, handleOffboardTenantInfra } from './data-isolation/lifecycle-handlers.js';
import { handlePromoteTenantEnvironment } from './data-isolation/health-metrics-handler.js';
import { handleDeployRollout } from './infrastructure/rollout-handler.js';
import {
  createDeployLogger,
  createDeploymentStatusUpdater,
  handleDeployMicroservice,
} from './deploy/deploy-microservice.js';
import { loadDataIsolationConfig } from './data-isolation/config.js';

// Falha no boot se o isolamento de dados estiver ligado e mal configurado.
const dataIsolation = loadDataIsolationConfig();
console.log(
  dataIsolation.enabled
    ? `[Data Isolation] Habilitado: ${dataIsolation.tables.length} tabela(s) com escopo de tenant`
    : '[Data Isolation] Desabilitado (DATA_ISOLATION_ENABLED != true): reconciliações serão ignoradas',
);

const prisma = new PrismaClient();
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const connection = { host: REDIS_HOST, port: REDIS_PORT };
const redisPublisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
const appendLog = createDeployLogger(prisma, redisPublisher);
const setDeploymentStatus = createDeploymentStatusUpdater(prisma);

console.log(`[Provisioner Worker] Inicializando e conectando ao Redis em ${REDIS_HOST}:${REDIS_PORT}...`);

const worker = createProvisionerWorker({ 
  connection, 
  prisma, 
  redisPublisher,
  handlers: {
    'deploy-tenant-infra': (job: Job) => handleDeployTenantInfra(job, prisma),
    'deprovision-tenant-infra': (job: Job) => handleDeprovisionTenantInfra(job, prisma),
    'reconcile-plan-migration': (job: Job) => handleReconcilePlanMigration(job, prisma),
    'apply-downgrade-reconciliation': (job: Job) => handleApplyDowngradeReconciliation(job, prisma),
    'backup-tenant-infra': (job: Job) => handleBackupTenantInfra(job, prisma),
    'restore-tenant-infra': (job: Job) => handleRestoreTenantInfra(job, prisma),
    'clone-tenant-environment': (job: Job) => handleCloneTenantEnvironment(job, prisma),
    'offboard-tenant-infra': (job: Job) => handleOffboardTenantInfra(job, prisma),
    'promote-tenant-environment': (job: Job) => handlePromoteTenantEnvironment(job, prisma),
    'deploy-rollout': (job: Job) => handleDeployRollout(job, prisma),
    'deploy-microservice': (job: Job) =>
      handleDeployMicroservice(job, job.data.deploymentId || null, appendLog, setDeploymentStatus),
  }
});

worker.on('completed', job => {
  console.log(`[Sucesso] Job ${job.id} concluído.`);
});

worker.on('failed', (job, err) => {
  console.log(`[Erro] Job ${job?.id} falhou com a mensagem: ${err.message}`);
});

const metricsPort = Number(process.env.METRICS_PORT) || 9464;
const metricsHost = process.env.METRICS_HOST || '127.0.0.1';
const server = startMetricsServer(metricsPort, metricsHost);
console.log(`[Metrics] Servidor rodando em http://${metricsHost}:${metricsPort}/metrics`);

async function shutdown(signal: string) {
  console.log(`\n[${signal}] Desligando graciosamente...`);
  try {
    await worker.close();
    server.close();
    await redisPublisher.quit();
    await prisma.$disconnect();
    console.log('[Shutdown] Concluído.');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown Erro]', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
