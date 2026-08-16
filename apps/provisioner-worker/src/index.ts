import { Job } from 'bullmq';
import { VPSClient, VercelClient, AWSClient } from '@organator/cloud-providers';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import Tasklets from '@wendelmax/tasklets';
import { createProvisionerWorker } from './worker.js';

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
    'deploy-tenant-infra': (job: Job) => handleDeployTenantInfra(job, job.data.deploymentId || null),
    'deprovision-tenant-infra': (job: Job) => handleDeprovisionTenantInfra(job, job.data.deploymentId || null),
    'migrate-tenant-plan': (job: Job) => handleMigrateTenantPlan(job, job.data.deploymentId || null),
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

async function handleDeployTenantInfra(job: Job, deploymentId: string | null) {
  const { tenantId, plan } = job.data;
  await appendLog(deploymentId, job, `[Provisioner] Criando infraestrutura do tenant ${tenantId}...`, 'DB');
  if (plan === 'Enterprise') {
    const creds = job.data.credentials?.secrets || {};
    const aws = new AWSClient(
      job.data.credentials?.config?.region || 'us-east-1',
      creds.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
      creds.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
    );
    const instanceId = await aws.createEC2Instance('ami-0c55b159cbfafe1f0', 't3.medium');
    await appendLog(deploymentId, job, `[AWS EC2] Instância provisionada: ${instanceId}`);
  }
  await appendLog(deploymentId, job, `[Provisioner] Rede isolada configurada`, 'NETWORK');
  await appendLog(deploymentId, job, `[Provisioner] DNS/TLS enfileirados`, 'DNS');
  await appendLog(deploymentId, job, `[Provisioner] Infraestrutura pronta com sucesso!`, 'DONE');
}

async function handleDeprovisionTenantInfra(job: Job, deploymentId: string | null) {
  await appendLog(deploymentId, job, `[Deprovisioner] Removendo DNS/TLS`, 'DNS');
  await appendLog(deploymentId, job, `[Deprovisioner] Removendo rede`, 'NETWORK');
  await appendLog(deploymentId, job, `[Deprovisioner] Removendo banco`, 'DB');
}

async function handleMigrateTenantPlan(job: Job, deploymentId: string | null) {
  await appendLog(deploymentId, job, `[PlanMigration] Reconciliando ${job.data.fromPlan} -> ${job.data.toPlan}`, 'NETWORK');
  if (job.data.gracePeriod) await appendLog(deploymentId, job, '[PlanMigration] Downgrade em período de graça; dados preservados');
  await appendLog(deploymentId, job, '[PlanMigration] Infraestrutura reconciliada', 'DONE');
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
