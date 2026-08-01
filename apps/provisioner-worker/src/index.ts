import { Worker, Job } from 'bullmq';
import { VPSClient, VercelClient, AWSClient } from '@organator/cloud-providers';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import Tasklets from '@wendelmax/tasklets';

const prisma = new PrismaClient();
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const connection = { host: REDIS_HOST, port: REDIS_PORT };
const redisPublisher = new Redis({ host: REDIS_HOST, port: REDIS_PORT });

console.log(`[Provisioner Worker] Inicializando e conectando ao Redis em ${REDIS_HOST}:${REDIS_PORT}...`);

const worker = new Worker('provisioner', async (job: Job) => {
  console.log(`\n======================================================`);
  console.log(`[Job Recebido] ID: ${job.id} | Nome: ${job.name}`);
  
  let deploymentId: string | null = job.data.deploymentId || null;
  if (job.data.serviceId && !deploymentId) {
    try {
      const dep = await prisma.deployment.create({
        data: {
          microserviceId: job.data.serviceId,
          status: 'RUNNING',
          logs: `[${new Date().toISOString()}] Job de deploy iniciado...\n`,
        }
      });
      deploymentId = dep.id;
    } catch (e: any) {
      console.warn(`[Prisma Warning] Não foi possível criar registro de Deployment: ${e.message}`);
    }
  }

  if (deploymentId) {
    const initialLog = `[${new Date().toISOString()}] Job de deploy iniciado...\n`;
    redisPublisher.publish(
      `deploy_logs:${deploymentId}`,
      JSON.stringify({ deploymentId, logLine: initialLog, status: 'RUNNING' })
    ).catch((e: any) => console.warn(`[Redis Pub Warning] ${e.message}`));
  }

  try {
    if (job.name === 'deploy-tenant-infra') {
      await handleDeployTenantInfra(job, deploymentId);
    } else if (job.name === 'deploy-microservice') {
      await handleDeployMicroservice(job, deploymentId);
    }
    if (deploymentId) {
      const successLog = `[${new Date().toISOString()}] Deploy concluído com sucesso!\n`;
      const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: 'SUCCESS',
          logs: `${current?.logs || ''}${successLog}`
        }
      });
      await redisPublisher.publish(
        `deploy_logs:${deploymentId}`,
        JSON.stringify({ deploymentId, logLine: successLog, status: 'SUCCESS' })
      );
    }
    console.log(`======================================================\n`);
    return { success: true, finishedAt: new Date().toISOString() };
  } catch (err: any) {
    if (deploymentId) {
      const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      const errLog = `[${new Date().toISOString()}] [ERRO] ${err.message}\n`;
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { 
          status: 'FAILED',
          logs: `${current?.logs || ''}${errLog}`
        }
      });
      await redisPublisher.publish(
        `deploy_logs:${deploymentId}`,
        JSON.stringify({ deploymentId, logLine: errLog, status: 'FAILED' })
      );
    }
    console.log(`======================================================\n`);
    throw err;
  }
}, { connection });

async function appendLog(deploymentId: string | null, job: Job, msg: string, status: string = 'RUNNING') {
  console.log(msg);
  await job.log(msg);
  if (deploymentId) {
    const logLine = `[${new Date().toISOString()}] ${msg}\n`;
    // Processamento de log (sanitização de segredos + truncamento) offloadado p/ worker thread
    const processed = await processLogLine(logLine);
    try {
      const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { logs: `${current?.logs || ''}${processed}` }
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

/**
 * Sanitiza e limita o tamanho de uma linha de log em worker thread (Tasklets),
 * evitando bloquear o event loop do worker do BullMQ com payloads grandes.
 */
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
  await appendLog(deploymentId, job, `[Provisioner] Criando infraestrutura do tenant ${tenantId}...`);
  if (plan === 'Enterprise') {
    const aws = new AWSClient('us-east-1', process.env.AWS_ACCESS_KEY_ID || '', process.env.AWS_SECRET_ACCESS_KEY || '');
    const instanceId = await aws.createEC2Instance('ami-0c55b159cbfafe1f0', 't3.medium');
    await appendLog(deploymentId, job, `[AWS EC2] Instância provisionada: ${instanceId}`);
  }
  await appendLog(deploymentId, job, `[Provisioner] Infraestrutura pronta com sucesso!`);
}

async function handleDeployMicroservice(job: Job, deploymentId: string | null) {
  const { serviceId, provider, repo, vpsHost } = job.data;
  await appendLog(deploymentId, job, `[Deploy] Serviço ${serviceId} -> Nuvem: ${provider}`);
  if (provider === 'VERCEL') {
    const vercel = new VercelClient(process.env.VERCEL_TOKEN || 'mock-token');
    const project = await vercel.createProject(`service-${serviceId}`, repo);
    await vercel.injectEnvVar(project.id, 'SERVICE_ID', String(serviceId));
    const url = await vercel.createDeployment(project.id);
    await appendLog(deploymentId, job, `[Vercel] Build completo: ${url}`);
  } else if (provider === 'VPS') {
    const [user, host] = (vpsHost || 'root@localhost').split('@');
    const vps = new VPSClient(host, 22, user, process.env.SSH_PRIVATE_KEY || 'mock-key');
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
