import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const PROVIDERS = ['route53', 'cloudflare', 'vercel'];

@Injectable()
export class DomainsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(tenantId: string, input: { hostname: string; provider: string; microserviceId?: string }, actorId: string) {
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(input.hostname) || !input.hostname.includes('.')) throw new BadRequestException('Hostname inválido');
    if (!PROVIDERS.includes(input.provider)) throw new BadRequestException('Provedor DNS inválido');
    if (input.microserviceId) {
      const service = await this.prisma.microservice.findFirst({ where: { id: input.microserviceId, tenantId } });
      if (!service) throw new NotFoundException('Microservice não pertence ao tenant');
    }
    const domain = await this.prisma.domain.create({ data: { tenantId, hostname: input.hostname.toLowerCase(), provider: input.provider, microserviceId: input.microserviceId ?? null } });
    await this.audit.record({ actorId, action: 'domain.created', resourceType: 'Domain', resourceId: domain.id, changes: { hostname: domain.hostname, provider: domain.provider, tenantId } });
    return domain;
  }

  list(tenantId: string, microserviceId?: string) {
    return this.prisma.domain.findMany({ where: { tenantId, ...(microserviceId ? { microserviceId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async remove(tenantId: string, id: string, actorId: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id, tenantId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    await this.prisma.domain.delete({ where: { id } });
    await this.audit.record({ actorId, action: 'domain.deleted', resourceType: 'Domain', resourceId: id, changes: { hostname: domain.hostname } });
    return { deleted: true };
  }

  async validate(tenantId: string, id: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id, tenantId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    // DNS/TLS providers update this state asynchronously via the provisioner job.
    return { id: domain.id, hostname: domain.hostname, status: domain.status, tlsStatus: domain.tlsStatus, nextAction: domain.status === 'active' ? 'none' : 'provision-domain' };
  }
}
