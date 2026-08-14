import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProvisioningService {
  constructor(private readonly prisma: PrismaService, @InjectQueue('provisioner') private readonly queue: Queue, private readonly audit: AuditService) {}

  async provision(tenantId: string, actorId: string) {
    const key = `tenant-infra:${tenantId}`;
    const existing = await this.prisma.deployment.findUnique({ where: { idempotencyKey: key } });
    if (existing && ['RUNNING', 'SUCCESS'].includes(existing.status)) return existing;
    const job = await this.queue.add('deploy-tenant-infra', { tenantId, action: 'INITIAL_PROVISIONING', idempotencyKey: key, actorId }, { jobId: key, removeOnComplete: false });
    await this.audit.record({ actorId, action: 'TENANT_INFRA_PROVISION_QUEUED', resourceType: 'TENANT', resourceId: tenantId, changes: { jobId: job.id, idempotencyKey: key } });
    return { jobId: job.id, status: 'QUEUED', idempotencyKey: key };
  }

  async deprovision(tenantId: string, actorId: string) {
    const key = `tenant-deprovision:${tenantId}`;
    const job = await this.queue.add('deprovision-tenant-infra', { tenantId, action: 'DEPROVISION', idempotencyKey: key, actorId }, { jobId: key, removeOnComplete: false });
    await this.audit.record({ actorId, action: 'TENANT_INFRA_DEPROVISION_QUEUED', resourceType: 'TENANT', resourceId: tenantId, changes: { jobId: job.id, idempotencyKey: key } });
    return { jobId: job.id, status: 'QUEUED', idempotencyKey: key };
  }
}
