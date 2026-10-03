import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@organator/core-models';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { bullJobId } from '../common/queue';

/** Um pedido por dia por titular: devolve o pedido em aberto em vez de repetir. */
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Só o titular, autenticado como usuário (API keys não representam uma pessoa). */
function subjectOf(
  user: { userId?: string; apiKeyAuth?: boolean } | undefined,
) {
  if (!user?.userId || user.apiKeyAuth) {
    throw new ForbiddenException(
      'Data exports are available to signed-in users only',
    );
  }
  return user.userId;
}

const summary = {
  id: true,
  scope: true,
  tenantId: true,
  status: true,
  createdAt: true,
  completedAt: true,
  expiresAt: true,
} as const;

/**
 * Exportação dos dados pessoais do titular (LGPD art. 18-V, #109). O arquivo é
 * gerado pelo worker, fica disponível só para o próprio titular até expirar e
 * então é apagado.
 */
@Injectable()
export class ComplianceService implements OnModuleInit {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional()
    @InjectQueue('provisioner')
    private readonly queue?: Queue,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    void this.purgeExpired();
    setInterval(() => void this.purgeExpired(), CLEANUP_INTERVAL_MS);
  }

  /** Exportação dos dados do próprio titular. */
  async requestExport(
    user: { userId: string; email?: string; apiKeyAuth?: boolean },
    ip?: string | null,
  ) {
    subjectOf(user);
    return this.createRequest(user, { scope: 'USER', tenantId: null }, ip, {
      action: 'compliance.export_requested',
      resourceType: 'DataExport',
    });
  }

  /**
   * Dataset de um tenant inteiro (compliance/DPO). Só o admin da plataforma
   * pede (RolesGuard no controller) e só quem pediu baixa.
   */
  async requestTenantExport(
    user: { userId: string; email?: string; apiKeyAuth?: boolean },
    tenantId: string,
    ip?: string | null,
  ) {
    subjectOf(user);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.createRequest(user, { scope: 'TENANT', tenantId }, ip, {
      action: 'compliance.tenant_export_requested',
      resourceType: 'Tenant',
      resourceId: tenantId,
    });
  }

  private async createRequest(
    user: { userId: string; email?: string },
    target: { scope: 'USER' | 'TENANT'; tenantId: string | null },
    ip: string | null | undefined,
    auditEvent: { action: string; resourceType: string; resourceId?: string },
  ) {
    const recent = await this.prisma.dataExport.findFirst({
      where: {
        userId: user.userId,
        scope: target.scope,
        tenantId: target.tenantId,
        status: { in: ['PENDING', 'READY'] },
        createdAt: { gt: new Date(Date.now() - REQUEST_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: summary,
    });
    if (recent) return recent;

    const request = await this.prisma.dataExport.create({
      data: {
        userId: user.userId,
        scope: target.scope,
        tenantId: target.tenantId,
      },
      select: summary,
    });
    try {
      if (!this.queue) throw new Error('Provisioner queue not configured');
      await this.queue.add(
        'generate-data-export',
        { exportId: request.id },
        { jobId: bullJobId(`data-export:${request.id}`) },
      );
    } catch (err) {
      // Sem job ninguém gera o arquivo: o pedido não pode ficar PENDING.
      await this.prisma.dataExport.update({
        where: { id: request.id },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 500) },
      });
      throw err;
    }
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email ?? null,
      ip: ip ?? null,
      action: auditEvent.action,
      resourceType: auditEvent.resourceType,
      resourceId: auditEvent.resourceId ?? request.id,
      changes: { exportId: request.id },
    });
    return request;
  }

  listExports(user: { userId: string; apiKeyAuth?: boolean }) {
    return this.prisma.dataExport.findMany({
      where: { userId: subjectOf(user) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: summary,
    });
  }

  /** Só o próprio titular baixa; de outro usuário responde 404. */
  async download(
    user: { userId: string; email?: string; apiKeyAuth?: boolean },
    exportId: string,
    ip?: string | null,
  ) {
    const found = await this.prisma.dataExport.findFirst({
      where: { id: exportId, userId: subjectOf(user) },
    });
    if (!found) throw new NotFoundException('Export not found');
    if (
      found.status === 'EXPIRED' ||
      (found.expiresAt && found.expiresAt < new Date())
    ) {
      throw new GoneException(
        'Este arquivo expirou. Solicite uma nova exportação.',
      );
    }
    if (found.status !== 'READY' || !found.content) {
      throw new NotFoundException('Export is not ready yet');
    }
    await this.audit.record({
      actorId: user.userId,
      actorEmail: user.email ?? null,
      ip: ip ?? null,
      action: 'compliance.export_downloaded',
      resourceType: 'DataExport',
      resourceId: exportId,
      changes: {},
    });
    return found.content;
  }

  /** Apaga o conteúdo das exportações vencidas (o registro fica como EXPIRED). */
  async purgeExpired(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.dataExport.updateMany({
        where: { status: 'READY', expiresAt: { lt: now } },
        data: { status: 'EXPIRED', content: Prisma.DbNull },
      });
      if (count) this.logger.log(`Data exports expired: ${count}`);
      return count;
    } catch (err) {
      this.logger.warn(`Data export cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
