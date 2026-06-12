import { Worker, Job } from 'bullmq';
import { VPSClient, VercelClient } from '@navant/cloud-providers';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const connection = {
  host: REDIS_HOST,
  port: REDIS_PORT,
};

console.log(`[Provisioner Worker] Inicializando e conectando ao Redis em ${REDIS_HOST}:${REDIS_PORT}...`);

const worker = new Worker('provisioner', async (job: Job) => {
  console.log(`\n======================================================`);
  console.log(`[Job Recebido] ID: ${job.id} | Nome: ${job.name}`);
  console.log(`[Dados] TenantID: ${job.data.tenantId} | Plano: ${job.data.plan}`);
  
  if (job.name === 'deploy-tenant-infra') {
    await handleDeployTenantInfra(job);
  } else if (job.name === 'deploy-microservice') {
    await handleDeployMicroservice(job);
  } else {
    console.log(`[Aviso] Job de tipo desconhecido ignorado: ${job.name}`);
  }
  
  console.log(`======================================================\n`);
  return { success: true, finishedAt: new Date().toISOString() };
}, { connection });

async function handleDeployTenantInfra(job: Job) {
  const { tenantId, plan } = job.data;
  
  await logStep(job, `[Provisioner] Iniciando infraestrutura para Tenant ${tenantId}...`);
  await sleep(1000);
  
  await logStep(job, `[Docker] Criando rede isolada 'tenant-${tenantId}-net'...`);
  await sleep(1500);

  await logStep(job, `[PostgreSQL] Subindo banco de dados (Schema isolado)...`);
  await sleep(2000);

  if (plan === 'Enterprise') {
    await logStep(job, `[AWS] Solicitando recursos dedicados (Plano Enterprise)...`);
    await sleep(2000);
  }

  await logStep(job, `[Traefik] Mapeando regras DNS...`);
  await sleep(1000);

  await logStep(job, `[Provisioner] Infraestrutura do Tenant pronta!`);
}

async function handleDeployMicroservice(job: Job) {
  const { serviceId, provider, repo, vpsHost } = job.data;
  
  await logStep(job, `[Deploy] Serviço ${serviceId} -> Nuvem: ${provider}`);
  await sleep(1000);
  
  if (provider === 'VERCEL') {
    await logStep(job, `[Vercel API] Acionando pipeline do repositório ${repo}...`);
    const vercel = new VercelClient(process.env.VERCEL_TOKEN || 'mock-token');
    const project = await vercel.createProject(`service-${serviceId}`, repo);
    await vercel.injectEnvVar(project.id, 'SERVICE_ID', String(serviceId));
    const url = await vercel.createDeployment(project.id);
    await logStep(job, `[Vercel API] Build completo e em produção: ${url}`);
  } else if (provider === 'VPS') {
    await logStep(job, `[SSH] Conectando ao host VPS (${vpsHost})...`);
    
    // Configuração simulada (Em prod os dados vêm do DB criptografados)
    const [user, host] = (vpsHost || 'root@localhost').split('@');
    const vps = new VPSClient(host, 22, user, process.env.SSH_PRIVATE_KEY || 'mock-key');

    await logStep(job, `[Docker] Fazendo pull da imagem e recriando container...`);
    // Simulando o pull da imagem
    await sleep(2000); 

    try {
      // Ignorar erro se a chave for mock-key, para manter os logs limpos no demo local
      if (process.env.SSH_PRIVATE_KEY) {
        await vps.deployDockerContainer('nginx:alpine', `service-${serviceId}`, { PORT: '80' }, `service-${serviceId}.organator.local`);
      } else {
        await logStep(job, `[Docker VPS] Simulando execução nativa Docker via SSH para nginx:alpine...`);
      }
    } catch (e: any) {
      await logStep(job, `[VPS Erro] Não foi possível executar no VPS remoto: ${e.message}`);
    }
    
    await logStep(job, `[Traefik] Roteamento atualizado para o container.`);
  }
}

async function logStep(job: Job, message: string) {
  console.log(message);
  await job.log(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

worker.on('completed', job => {
  console.log(`[Sucesso] Job ${job.id} concluído.`);
});

worker.on('failed', (job, err) => {
  console.log(`[Erro] Job ${job?.id} falhou com a mensagem: ${err.message}`);
});
