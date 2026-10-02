import { Job } from 'bullmq';
import { VPSClient, VercelClient } from '@organator/cloud-providers';
import { PrismaClient } from '@organator/core-models';
import Redis from 'ioredis';
import Tasklets from '@wendelmax/tasklets';

const MAX_LINE_BYTES = 16 * 1024;
const SECRET_PATTERNS = [
  /sk_(test|live)_[A-Za-z0-9]+/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
  /password["']?\s*[:=]\s*["'][^"']+["']/gi,
  /token["']?\s*[:=]\s*["'][^"']+["']/gi,
];

// Autocontida: é serializada e executada numa worker thread pelo Tasklets.
const sanitize = (input: string, maxBytes: number, patterns: RegExp[]): string => {
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
};

/**
 * Redige segredos e limita o tamanho da linha de log. Roda numa worker thread;
 * se ela falhar, aplica a mesma redação na thread principal — nunca devolve a
 * linha original sem redação.
 */
export async function sanitizeLogLine(line: string): Promise<string> {
  return Tasklets.run(sanitize, line, MAX_LINE_BYTES, SECRET_PATTERNS).catch(() =>
    sanitize(line, MAX_LINE_BYTES, SECRET_PATTERNS),
  );
}

export type AppendLog = (deploymentId: string | null, job: Job, msg: string, status?: string) => Promise<void>;

export function createDeployLogger(prisma: PrismaClient, redisPublisher: Redis): AppendLog {
  return async (deploymentId, job, msg, status = 'RUNNING') => {
    console.log(msg);
    await job.log(msg);
    if (deploymentId) {
      const logLine = `[${new Date().toISOString()}] ${msg}\n`;
      const processed = await sanitizeLogLine(logLine);
      try {
        const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
        await prisma.deployment.update({
          where: { id: deploymentId },
          data: { logs: `${current?.logs || ''}${processed}`, phase: status },
        });
        await redisPublisher.publish(
          `deploy_logs:${deploymentId}`,
          JSON.stringify({ deploymentId, logLine: processed, status }),
        );
      } catch (e: any) {
        console.warn(`[Prisma Log Warning] ${e.message}`);
      }
    }
  };
}

export type DeploymentStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';
export type SetDeploymentStatus = (deploymentId: string | null, status: DeploymentStatus) => Promise<void>;

/** Grava o status do deploy (PENDING -> RUNNING -> SUCCESS | FAILED). */
export function createDeploymentStatusUpdater(prisma: PrismaClient): SetDeploymentStatus {
  return async (deploymentId, status) => {
    if (!deploymentId) return;
    try {
      await prisma.deployment.update({ where: { id: deploymentId }, data: { status } });
    } catch (e: any) {
      console.warn(`[Prisma Status Warning] ${e.message}`);
    }
  };
}

const noStatus: SetDeploymentStatus = async () => {};

export async function handleDeployMicroservice(
  job: Job,
  deploymentId: string | null,
  appendLog: AppendLog,
  setStatus: SetDeploymentStatus = noStatus,
) {
  const { serviceId, provider, repo, vpsHost, image } = job.data;
  const creds = job.data.credentials?.secrets || {};
  const config = job.data.credentials?.config || {};
  await setStatus(deploymentId, 'RUNNING');
  await appendLog(deploymentId, job, `[Deploy] Serviço ${serviceId} -> Nuvem: ${provider}`);
  try {
    if (provider === 'VERCEL') {
      const vercel = new VercelClient(creds.apiToken || process.env.VERCEL_TOKEN || 'mock-token');
      const project = await vercel.createProject(`service-${serviceId}`, repo);
      await vercel.injectEnvVar(project.id, 'SERVICE_ID', String(serviceId));
      const url = await vercel.createDeployment(project.id);
      await appendLog(deploymentId, job, `[Vercel] Build completo: ${url}`);
    } else if (provider === 'VPS' || provider === 'DOCKER_VPS') {
      // Antes publicava sempre nginx:alpine, qualquer que fosse o serviço.
      if (!image) throw new Error('Serviço VPS sem imagem Docker configurada');
      const [user, host] = (vpsHost || config.host || 'root@localhost').split('@');
      const vps = new VPSClient(host, Number(config.port) || 22, user, creds.privateKey || process.env.SSH_PRIVATE_KEY || 'mock-key');
      const domain = `service-${serviceId}.${process.env.WILDCARD_DOMAIN || 'organator.local'}`;
      const result = await vps.deployDockerContainer(image, `service-${serviceId}`, { PORT: '80' }, domain);
      await appendLog(deploymentId, job, `[SSH VPS] Imagem docker implantada com sucesso em ${host}. Resultado: ${result}`);
    } else {
      // Sem deploy automatizado para este provedor: não reportar sucesso.
      throw new Error(`Deploy automatizado não suportado para o provedor ${provider}`);
    }
  } catch (err) {
    await appendLog(deploymentId, job, `[Deploy] Falhou: ${(err as Error).message}`, 'FAILED');
    await setStatus(deploymentId, 'FAILED');
    throw err;
  }
  await setStatus(deploymentId, 'SUCCESS');
}
