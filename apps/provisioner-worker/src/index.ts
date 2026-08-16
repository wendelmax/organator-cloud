import { Job } from 'bullmq';
import { VPSClient, VercelClient, AWSClient } from '@organator/cloud-providers';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import Tasklets from '@wendelmax/tasklets';
import { createProvisionerWorker } from './worker.js';
import { startMetricsServer } from './data-isolation/metrics-server.js';
import { handleDeployTenantInfra, handleDeprovisionTenantInfra } from './infrastructure/infra-handler.js';
import { handleReconcilePlanMigration, handleApplyDowngradeReconciliation } from './data-isolation/plan-migration-handler.js';
import { handleBackupTenantInfra, handleRestoreTenantInfra, handleCloneTenantEnvironment, handleOffboardTenantInfra } from './data-isolation/lifecycle-handlers.js';
import { handleCollectTenantMetrics, handlePromoteTenantEnvironment } from './data-isolation/health-metrics-handler.js';
import { handleDeployRollout } from './infrastructure/rollout-handler.js';

const prisma = new PrismaClient();
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const connection = { host: REDIS_HOST, port: REDIS_PORT };
const redisPublisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

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
    'collect-tenant-metrics': (job: Job) => handleCollectTenantMetrics(job, prisma),
    'promote-tenant-environment': (job: Job) => handlePromoteTenantEnvironment(job, prisma),
    'deploy-rollout': (job: Job) => handleDeployRollout(job, prisma),
    'deploy-microservice': (job: Job) => handleDeployMicroservice(job, job.data.deploymentId || null),
  }
});

async function appendLog(deploymentId: string | null, job: Job, msg: string, status: string = 'RUNNING') {
  console.log(msg);
  await job.log(msg);
  if (deploymentId) {
    const logLine = `[${new Date().toISOString()}] ${msg}\n`;
    const processed = await processLogLine(logLine);
    try {
      const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { logs: `${current?.logs || ''}${processed}`, phase: status }
      });
      await redisPublisher.publish(
        `deploy_logs:${deploymentId}`,
        JSON.stringify({ deploymentId, logLine: processed, status })
      );
    } catch (e: any) {
      console.warn(`[Prisma Log Warning] ${e.message}`);
    }
  }
}

async function processLogLine(line: string): Promise<string> {
  const MAX_LINE_BYTES = 16 * 1024;
  const SECRET_PATTERNS = [
    /sk_(test|live)_[A-Za-z0-9]+/g,
    /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    /password["']?\s*[:=]\s*["'][^"']+["']/gi,
    /token["']?\s*[:=]\s*["'][^"']+["']/gi,
  ];

  return Tasklets.run((input: string, maxBytes: number, patterns: RegExp[]) => {
    let sanitized = input;
    for (const pattern of patterns) {
      sanitized = sanitized.replace(pattern, (match) => {
        const keep = match.length > 12 ? match.slice(0, 6) + '[REDACTED]' : '[REDACTED]';
        return keep;
      });
    }
    if (Buffer.byteLength(sanitized, 'utf8') > maxBytes) {
      sanitized = sanitized.slice(0, maxBytes) + '\n[TRUNCATED]\n';
    }
    return sanitized;
  }, line, MAX_LINE_BYTES, SECRET_PATTERNS).catch(() => line);
}


async function handleDeployMicroservice(job: Job, deploymentId: string | null) {
  const { serviceId, provider, repo, vpsHost } = job.data;
  const creds = job.data.credentials?.secrets || {};
  const config = job.data.credentials?.config || {};
  await appendLog(deploymentId, job, `[Deploy] Serviço ${serviceId} -> Nuvem: ${provider}`);
  if (provider === 'VERCEL') {
    const vercel = new VercelClient(creds.apiToken || process.env.VERCEL_TOKEN || 'mock-token');
    const project = await vercel.createProject(`service-${serviceId}`, repo);
    await vercel.injectEnvVar(project.id, 'SERVICE_ID', String(serviceId));
    const url = await vercel.createDeployment(project.id);
    await appendLog(deploymentId, job, `[Vercel] Build completo: ${url}`);
  } else if (provider === 'VPS') {
    const [user, host] = (vpsHost || config.host || 'root@localhost').split('@');
    const vps = new VPSClient(host, Number(config.port) || 22, user, creds.privateKey || process.env.SSH_PRIVATE_KEY || 'mock-key');
    const result = await vps.deployDockerContainer('nginx:alpine', `service-${serviceId}`, { PORT: '80' }, `service-${serviceId}.organator.local`);
    await appendLog(deploymentId, job, `[SSH VPS] Imagem docker implantada com sucesso em ${host}. Resultado: ${result}`);
  }
}

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
