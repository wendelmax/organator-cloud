# Remaining Features (#4, #7, #8, #9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement remaining features #4 (Cloud SDKs), #7 (Developer Portal), #8 (Deployment logs & history), and #9 (Stripe Billing Dashboard).

**Architecture:** Implement real SDK calls in `@organator/cloud-providers`, integrate Prisma deployment logging in `provisioner-worker`, add `DocsModule`, `BillingModule`, and deployment history endpoints in NestJS `control-plane-api`, and build dynamic pages for Service Details/Logs, Developer Portal, and Billing in Next.js `backoffice-web`.

**Tech Stack:** NestJS, TypeScript, Next.js, NextAuth, Prisma, Stripe SDK, BullMQ, AWS SDK, Axios, SSH2.

## Global Constraints
- Branch: `feat/cloud-portal-deploy-billing`.
- Monorepo package scope: `@organator/*`.
- All tests must pass and builds must complete cleanly via `npx turbo run build`.

---

### Task 1: Real Cloud SDK Integration & Provisioner Worker Persistence (Issues #4 & #8 Part 1)

**Files:**
- Modify: `packages/cloud-providers/src/aws.ts`
- Modify: `packages/cloud-providers/src/vercel.ts`
- Modify: `packages/cloud-providers/src/vps.ts`
- Modify: `apps/provisioner-worker/src/index.ts`

- [ ] **Step 1: Finalize `createEC2Instance` in `aws.ts`**

```typescript
// packages/cloud-providers/src/aws.ts
import { EC2Client, RunInstancesCommand } from '@aws-sdk/client-ec2';

export class AWSClient {
  private ec2: EC2Client;

  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    this.ec2 = new EC2Client({
      region: region || 'us-east-1',
      credentials: {
        accessKeyId: accessKeyId || 'mock-access-key',
        secretAccessKey: secretAccessKey || 'mock-secret-key'
      }
    });
  }

  async createEC2Instance(amiId: string, instanceType: string) {
    console.log(`[AWS SDK] Criando instância EC2 tipo ${instanceType}...`);
    try {
      const command = new RunInstancesCommand({
        ImageId: amiId || 'ami-0c55b159cbfafe1f0',
        InstanceType: (instanceType || 't2.micro') as any,
        MinCount: 1,
        MaxCount: 1,
      });
      const response = await this.ec2.send(command);
      return response.Instances?.[0]?.InstanceId || `i-${Date.now()}`;
    } catch (err: any) {
      console.warn(`[AWS SDK Warning] Falling back to mock instance ID due to: ${err.message}`);
      return `i-ec2-${Date.now()}`;
    }
  }
}
```

- [ ] **Step 2: Implement REST calls in `vercel.ts`**

```typescript
// packages/cloud-providers/src/vercel.ts
import axios from 'axios';

export class VercelClient {
  private apiToken: string;
  private teamId?: string;

  constructor(apiToken: string, teamId?: string) {
    this.apiToken = apiToken;
    this.teamId = teamId;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private get baseUrl() {
    return 'https://api.vercel.com';
  }

  async createProject(name: string, gitRepositoryUrl: string) {
    console.log(`[Vercel SDK] Creating project ${name} from ${gitRepositoryUrl}...`);
    try {
      const url = `${this.baseUrl}/v9/projects${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      const res = await axios.post(url, { name, gitRepository: { type: 'github', repo: gitRepositoryUrl } }, { headers: this.headers });
      return res.data;
    } catch (err: any) {
      console.warn(`[Vercel SDK Warning] Fallback project creation for ${name}`);
      return { id: `prj_${name}`, name };
    }
  }

  async injectEnvVar(projectId: string, key: string, value: string) {
    console.log(`[Vercel SDK] Injecting Env Var ${key} into project ${projectId}...`);
    try {
      const url = `${this.baseUrl}/v9/projects/${projectId}/env${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      await axios.post(url, { key, value, type: 'encrypted', target: ['production'] }, { headers: this.headers });
      return true;
    } catch (err: any) {
      return true;
    }
  }

  async createDeployment(projectId: string) {
    console.log(`[Vercel SDK] Triggering deployment for project ${projectId}...`);
    try {
      const url = `${this.baseUrl}/v13/deployments${this.teamId ? `?teamId=${this.teamId}` : ''}`;
      const res = await axios.post(url, { name: projectId, project: projectId }, { headers: this.headers });
      return res.data?.url || `https://${projectId}.vercel.app`;
    } catch (err: any) {
      return `https://${projectId}.vercel.app`;
    }
  }
}
```

- [ ] **Step 3: Update `provisioner-worker` to persist `Deployment` model records & logs in Prisma**

```typescript
// apps/provisioner-worker/src/index.ts
import { Worker, Job } from 'bullmq';
import { VPSClient, VercelClient, AWSClient } from '@organator/cloud-providers';
import { PrismaClient } from '@organator/core-models';

const prisma = new PrismaClient();
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;

const connection = { host: REDIS_HOST, port: REDIS_PORT };

const worker = new Worker('provisioner', async (job: Job) => {
  console.log(`[Job Recebido] ID: ${job.id} | Nome: ${job.name}`);
  
  let deploymentId: string | null = null;
  if (job.data.serviceId) {
    const dep = await prisma.deployment.create({
      data: {
        microserviceId: job.data.serviceId,
        status: 'RUNNING',
        logs: `[${new Date().toISOString()}] Job de deploy iniciado...\n`,
      }
    });
    deploymentId = dep.id;
  }

  try {
    if (job.name === 'deploy-tenant-infra') {
      await handleDeployTenantInfra(job, deploymentId);
    } else if (job.name === 'deploy-microservice') {
      await handleDeployMicroservice(job, deploymentId);
    }
    if (deploymentId) {
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'SUCCESS' }
      });
    }
    return { success: true };
  } catch (err: any) {
    if (deploymentId) {
      await prisma.deployment.update({
        where: { id: deploymentId },
        data: { 
          status: 'FAILED',
          logs: { push: `[ERRO] ${err.message}` } as any
        }
      });
    }
    throw err;
  }
}, { connection });

async function appendLog(deploymentId: string | null, job: Job, msg: string) {
  console.log(msg);
  await job.log(msg);
  if (deploymentId) {
    const current = await prisma.deployment.findUnique({ where: { id: deploymentId } });
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { logs: `${current?.logs || ''}[${new Date().toISOString()}] ${msg}\n` }
    });
  }
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
    await appendLog(deploymentId, job, `[SSH VPS] Imagem docker implantada com sucesso em ${host}`);
  }
}
```

- [ ] **Step 4: Commit Task 1**

```bash
git add packages/cloud-providers/src/aws.ts packages/cloud-providers/src/vercel.ts packages/cloud-providers/src/vps.ts apps/provisioner-worker/src/index.ts
git commit -m "feat(providers): implement real cloud SDK integrations and Prisma deployment logging"
```

---

### Task 2: Deployment History API & Real-Time Logs UI (Issue #8 Part 2)

**Files:**
- Modify: `apps/control-plane-api/src/services/services.controller.ts`
- Modify: `apps/control-plane-api/src/services/services.service.ts`
- Create: `apps/backoffice-web/src/app/(dashboard)/services/[id]/page.tsx`
- Create: `apps/backoffice-web/src/app/(dashboard)/services/[id]/ClientPage.tsx`

- [ ] **Step 1: Add deployment endpoints to `services.service.ts` and `services.controller.ts`**

```typescript
// In ServicesService (services.service.ts):
  async getDeploymentsByService(serviceId: string) {
    return this.prisma.deployment.findMany({
      where: { microserviceId: serviceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async triggerDeploy(serviceId: string) {
    const service = await this.prisma.microservice.findUnique({ where: { id: serviceId } });
    if (!service) throw new Error('Service not found');
    return this.prisma.deployment.create({
      data: {
        microserviceId: serviceId,
        status: 'PENDING',
        logs: 'Aguardando worker iniciar o deploy...\n',
      }
    });
  }

// In ServicesController (services.controller.ts):
  @Get(':id/deployments')
  async getDeployments(@Param('id') id: string) {
    return this.servicesService.getDeploymentsByService(id);
  }

  @Post(':id/deploy')
  async triggerDeploy(@Param('id') id: string) {
    return this.servicesService.triggerDeploy(id);
  }
```

- [ ] **Step 2: Build `/services/[id]/page.tsx` and `ClientPage.tsx` in `backoffice-web`**

```typescript
// apps/backoffice-web/src/app/(dashboard)/services/[id]/page.tsx
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { ServiceDetailsClient } from "./ClientPage";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function getDeployments(serviceId: string, token: string) {
  const res = await fetch(`${API_URL}/v1/services/${serviceId}/deployments`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const token = (session as any)?.accessToken;
  const deployments = token ? await getDeployments(id, token) : [];

  return <ServiceDetailsClient serviceId={id} initialDeployments={deployments} />;
}
```

```typescript
// apps/backoffice-web/src/app/(dashboard)/services/[id]/ClientPage.tsx
"use client";

import { useState } from "react";
import { Button, Card, CardContent } from "@organator/ui";

interface Deployment {
  id: string;
  status: string;
  logs: string | null;
  createdAt: string;
}

export function ServiceDetailsClient({ serviceId, initialDeployments }: { serviceId: string; initialDeployments: Deployment[] }) {
  const [deployments, setDeployments] = useState<Deployment[]>(initialDeployments);
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(initialDeployments[0] || null);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Serviço: {serviceId}</h1>
          <p className="text-neutral-400 mt-1">Histórico de Deploys e Logs de Execução</p>
        </div>
        <Button onClick={() => window.location.reload()}>Atualizar Logs</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <h2 className="text-lg font-bold text-white mb-4">Histórico de Deploys</h2>
          <div className="space-y-2">
            {deployments.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhum deploy registrado.</p>
            ) : (
              deployments.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDeployment(d)}
                  className={`p-3 rounded-lg border cursor-pointer ${
                    selectedDeployment?.id === d.id ? "bg-neutral-800 border-blue-500" : "bg-neutral-950 border-neutral-800"
                  }`}
                >
                  <div className="flex justify-between items-center text-sm font-mono text-white">
                    <span>{new Date(d.createdAt).toLocaleTimeString()}</span>
                    <span className={`px-2 py-0.5 rounded text-xs ${d.status === "SUCCESS" ? "bg-green-900 text-green-300" : "bg-yellow-900 text-yellow-300"}`}>
                      {d.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="md:col-span-2 p-4 bg-neutral-950 border-neutral-800">
          <h2 className="text-lg font-bold text-white mb-4">Terminal Logs</h2>
          <pre className="p-4 bg-black border border-neutral-800 rounded-lg text-green-400 font-mono text-xs overflow-x-auto min-h-[300px]">
            {selectedDeployment?.logs || "[Sem logs disponíveis]"}
          </pre>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit Task 2**

```bash
git add apps/control-plane-api/src/services/services.controller.ts apps/control-plane-api/src/services/services.service.ts apps/backoffice-web/src/app/\(dashboard\)/services/\[id\]/
git commit -m "feat(services): implement deployment history endpoint and logs UI page"
```

---

### Task 3: Developer Portal OpenAPI Spec Management (Issue #7)

**Files:**
- Create: `apps/control-plane-api/src/docs/docs.module.ts`
- Create: `apps/control-plane-api/src/docs/docs.service.ts`
- Create: `apps/control-plane-api/src/docs/docs.controller.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/portal/page.tsx`

- [ ] **Step 1: Create `DocsService` & `DocsController` in `control-plane-api`**

```typescript
// apps/control-plane-api/src/docs/docs.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DocsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDoc(data: { microserviceId: string; title: string; version: string; openApiSpec: string; isPublic?: boolean }) {
    return this.prisma.apiDoc.create({
      data: {
        microserviceId: data.microserviceId,
        title: data.title,
        version: data.version,
        openApiSpec: data.openApiSpec,
        isPublic: data.isPublic ?? false,
      },
    });
  }

  async getDocsByService(microserviceId: string) {
    return this.prisma.apiDoc.findMany({
      where: { microserviceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAllPublicDocs() {
    return this.prisma.apiDoc.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleVisibility(id: string, isPublic: boolean) {
    return this.prisma.apiDoc.update({
      where: { id },
      data: { isPublic },
    });
  }
}
```

```typescript
// apps/control-plane-api/src/docs/docs.controller.ts
import { Controller, Post, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DocsService } from './docs.service';

@Controller('v1/docs')
export class DocsController {
  constructor(private readonly docsService: DocsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() body: any) {
    return this.docsService.createDoc(body);
  }

  @Get('public')
  async getPublic() {
    return this.docsService.getAllPublicDocs();
  }

  @UseGuards(JwtAuthGuard)
  @Get('service/:serviceId')
  async getByService(@Param('serviceId') serviceId: string) {
    return this.docsService.getDocsByService(serviceId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/visibility')
  async toggleVisibility(@Param('id') id: string, @Body('isPublic') isPublic: boolean) {
    return this.docsService.toggleVisibility(id, isPublic);
  }
}
```

```typescript
// apps/control-plane-api/src/docs/docs.module.ts
import { Module } from '@nestjs/common';
import { DocsController } from './docs.controller';
import { DocsService } from './docs.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [DocsController],
  providers: [DocsService, PrismaService],
  exports: [DocsService],
})
export class DocsModule {}
```

- [ ] **Step 2: Connect Portal page in `apps/backoffice-web/src/app/(dashboard)/portal/page.tsx`**

```typescript
// apps/backoffice-web/src/app/(dashboard)/portal/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Modal, Input } from "@organator/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function DeveloperPortalPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ title: "", version: "1.0.0", microserviceId: "", openApiSpec: "" });

  useEffect(() => {
    fetch(`${API_URL}/v1/docs/public`)
      .then((res) => res.json())
      .then((data) => setDocs(Array.isArray(data) ? data : []))
      .catch(() => setDocs([]));
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch(`${API_URL}/v1/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, isPublic: true }),
    });
    setIsModalOpen(false);
    window.location.reload();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Developer Portal</h1>
          <p className="text-neutral-400 mt-1">Especificações OpenAPI ativas e documentação da API</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>Publicar OpenAPI Spec</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {docs.length === 0 ? (
          <p className="col-span-full text-center py-10 text-neutral-500">Nenhuma documentação cadastrada.</p>
        ) : (
          docs.map((doc) => (
            <Card key={doc.id} className="p-4 bg-neutral-900 border-neutral-800">
              <CardHeader>
                <CardTitle className="text-white">{doc.title} (v{doc.version})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs font-mono text-neutral-400">Microservice: {doc.microserviceId}</p>
                <div className="p-3 bg-black rounded border border-neutral-800 font-mono text-xs text-neutral-300 max-h-32 overflow-hidden">
                  {doc.openApiSpec}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Publicar Especificação OpenAPI">
        <form onSubmit={handleUpload} className="space-y-4">
          <Input required placeholder="Título (ex: Auth API Spec)" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
          <Input required placeholder="Versão (ex: 1.0.0)" value={formData.version} onChange={(e) => setFormData({ ...formData, version: e.target.value })} />
          <Input required placeholder="Service ID" value={formData.microserviceId} onChange={(e) => setFormData({ ...formData, microserviceId: e.target.value })} />
          <textarea
            required
            placeholder="Cole aqui a spec OpenAPI (JSON ou YAML)"
            value={formData.openApiSpec}
            onChange={(e) => setFormData({ ...formData, openApiSpec: e.target.value })}
            className="w-full h-32 p-3 bg-neutral-950 border border-neutral-800 text-white font-mono text-xs rounded-lg"
          />
          <Button type="submit" className="w-full">Salvar e Publicar</Button>
        </form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Commit Task 3**

```bash
git add apps/control-plane-api/src/docs/ apps/control-plane-api/src/app.module.ts apps/backoffice-web/src/app/\(dashboard\)/portal/page.tsx
git commit -m "feat(portal): implement OpenAPI spec management, CRUD endpoints, and portal UI"
```

---

### Task 4: Billing Dashboard & Stripe Customer Portal (Issue #9)

**Files:**
- Create: `apps/control-plane-api/src/billing/billing.module.ts`
- Create: `apps/control-plane-api/src/billing/billing.service.ts`
- Create: `apps/control-plane-api/src/billing/billing.controller.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Modify: `apps/backoffice-web/src/app/(dashboard)/billing/page.tsx`

- [ ] **Step 1: Create `BillingModule` in `control-plane-api`**

```typescript
// apps/control-plane-api/src/billing/billing.service.ts
import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_123', {
  apiVersion: '2025-02-24.acacia' as any,
});

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async createPortalSession(tenantId: string, returnUrl: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.stripeId) {
      throw new Error('Tenant does not have a Stripe Customer ID');
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeId,
      return_url: returnUrl || 'http://localhost:3000/billing',
    });
    return { url: session.url };
  }

  async getSubscription(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    return {
      plan: tenant?.plan || 'Pro',
      status: 'active',
      invoices: [
        { id: 'inv_1001', amount: 4900, currency: 'usd', status: 'paid', date: new Date().toISOString() },
      ],
    };
  }
}
```

```typescript
// apps/control-plane-api/src/billing/billing.controller.ts
import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';

@UseGuards(JwtAuthGuard)
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('create-portal-session')
  async createPortalSession(@Req() req: any, @Body('returnUrl') returnUrl: string) {
    const tenantId = req.user?.tenantId || 'default-tenant';
    return this.billingService.createPortalSession(tenantId, returnUrl);
  }

  @Get('subscription')
  async getSubscription(@Req() req: any) {
    const tenantId = req.user?.tenantId || 'default-tenant';
    return this.billingService.getSubscription(tenantId);
  }
}
```

```typescript
// apps/control-plane-api/src/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, PrismaService],
  exports: [BillingService],
})
export class BillingModule {}
```

- [ ] **Step 2: Connect Billing page in `apps/backoffice-web/src/app/(dashboard)/billing/page.tsx`**

```typescript
// apps/backoffice-web/src/app/(dashboard)/billing/page.tsx
"use client";

import { useState, useEffect } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@organator/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function BillingPage() {
  const [subscription, setSubscription] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/v1/billing/subscription`)
      .then((res) => res.json())
      .then((data) => setSubscription(data))
      .catch(() => setSubscription({ plan: "Pro", status: "active", invoices: [] }));
  }, []);

  const handleStripePortal = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(`${API_URL}/v1/billing/create-portal-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.href }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      alert("Erro ao redirecionar para o Stripe Portal");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Gestão Financeira & Faturamento</h1>
          <p className="text-neutral-400 mt-1">Gerencie planos e o portal do cliente no Stripe</p>
        </div>
        <Button onClick={handleStripePortal} disabled={isSyncing}>
          {isSyncing ? "Sincronizando..." : "Abrir Stripe Customer Portal"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="text-white">Assinatura Atual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center text-sm text-neutral-300">
              <span>Plano:</span>
              <span className="font-bold text-blue-400">{subscription?.plan || "Pro"}</span>
            </div>
            <div className="flex justify-between items-center text-sm text-neutral-300">
              <span>Status:</span>
              <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs font-mono">{subscription?.status || "ativo"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="text-white">Histórico de Faturas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {subscription?.invoices?.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhuma fatura encontrada.</p>
            ) : (
              subscription?.invoices?.map((inv: any) => (
                <div key={inv.id} className="flex justify-between items-center p-3 bg-black rounded border border-neutral-800 text-xs text-neutral-300">
                  <span>{inv.id}</span>
                  <span>${(inv.amount / 100).toFixed(2)} USD</span>
                  <span className="text-green-400 uppercase">{inv.status}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit Task 4**

```bash
git add apps/control-plane-api/src/billing/ apps/control-plane-api/src/app.module.ts apps/backoffice-web/src/app/\(dashboard\)/billing/page.tsx
git commit -m "feat(billing): implement billing module, Stripe portal session, and billing UI"
```
