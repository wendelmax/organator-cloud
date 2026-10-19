import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@organator/core-models';
import type {
  Incident,
  IncidentTenant,
  IncidentUpdate,
} from '@organator/core-models';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CreateIncidentInput {
  title: string;
  severity?: string;
  status?: string;
  component?: string;
  public?: boolean;
  assigneeEmail?: string;
  source?: string;
  alertKey?: string;
  postmortemUrl?: string;
}

export interface UpdateIncidentInput {
  title?: string;
  severity?: string;
  status?: string;
  component?: string;
  public?: boolean;
  assigneeEmail?: string;
  source?: string;
  alertKey?: string;
  postmortemUrl?: string;
}

/**
 * Incidentes operacionais (#110). O autor/ator vem sempre informado pelo
 * controller — o serviço não lê o JWT. Dedup de alertas por alertKey: enquanto
 * o incidente está aberto, o mesmo alertKey devolve o mesmo registro; ao
 * resolver, a chave é liberada para o próximo alerta disparar um novo
 * incidente.
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lista paginada para o painel de incidentes (admin da plataforma). */
  async list(filters: {
    status?: string;
    severity?: string;
    component?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    // Cada item traz a contagem de atualizações (_count.updates) para a
    // coluna "Updates" da listagem no painel (#110).
    items: (Incident & { _count: { updates: number } })[];
    total: number;
    page: number;
    pages: number;
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const where: Prisma.IncidentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.severity) where.severity = filters.severity;
    if (filters.component) where.component = filters.component;

    const [items, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { updates: true } } },
      }),
      this.prisma.incident.count({ where }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Abre um incidente; alertKey de incidente ainda aberto é idempotente. */
  async create(
    input: CreateIncidentInput,
    actor: { userId: string; email?: string },
  ): Promise<Incident> {
    if (input.alertKey) {
      // Dedup: somente incidentes não resolvidos bloqueiam a abertura.
      const existing = await this.prisma.incident.findFirst({
        where: { alertKey: input.alertKey, status: { not: 'resolved' } },
      });
      // Devolve intacto: sem duplicar e sem gerar novo registro de auditoria.
      if (existing) return existing;
    }

    const incident = await this.prisma.incident.create({
      data: {
        ...input,
        startedAt: new Date(), // o início do incidente é sempre registrado aqui
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'incident.create',
      resourceType: 'incident',
      resourceId: incident.id,
      changes: {
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        alertKey: incident.alertKey,
      },
    });
    return incident;
  }

  /** Incidente com a linha do tempo (updates) e o blast radius (affected). */
  async get(
    id: string,
  ): Promise<
    Incident & { updates: IncidentUpdate[]; affected: IncidentTenant[] }
  > {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        updates: { orderBy: { createdAt: 'asc' } },
        affected: { orderBy: { addedAt: 'asc' } },
      },
    });
    if (!incident) throw new NotFoundException(`Incident "${id}" not found`);
    return incident;
  }

  /**
   * Atualiza o incidente. Chegar em `resolved` preenche resolvedAt e libera o
   * alertKey; sair de `resolved` (reabrir) limpa resolvedAt.
   */
  async update(
    id: string,
    input: UpdateIncidentInput,
    actor: { userId: string; email?: string },
  ): Promise<Incident> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException(`Incident "${id}" not found`);

    const data: Prisma.IncidentUpdateInput = { ...input };
    const nextStatus = input.status ?? incident.status;
    if (nextStatus === 'resolved') {
      data.alertKey = null; // libera a chave para o próximo alerta
      if (incident.status !== 'resolved') data.resolvedAt = new Date();
    } else if (incident.status === 'resolved') {
      data.resolvedAt = null; // reaberto: volta a ficar em andamento
    }

    const updated = await this.prisma.incident.update({ where: { id }, data });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'incident.update',
      resourceType: 'incident',
      resourceId: id,
      changes: { ...input },
    });
    return updated;
  }

  /** Nova entrada na linha do tempo; o autor vem do controller. */
  async addUpdate(
    id: string,
    input: { status: string; message: string; internal?: boolean },
    authorEmail?: string,
  ): Promise<IncidentUpdate> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException(`Incident "${id}" not found`);

    const update = await this.prisma.incidentUpdate.create({
      data: {
        incidentId: id,
        status: input.status,
        message: input.message,
        internal: input.internal ?? false,
        authorEmail: authorEmail ?? null,
      },
    });
    await this.audit.record({
      actorEmail: authorEmail ?? null,
      action: 'incident.update.add',
      resourceType: 'incident',
      resourceId: id,
      changes: { status: update.status, internal: update.internal },
    });
    return update;
  }

  /** Vincula um tenant ao incidente (idempotente: já vinculado é noop). */
  async addAffected(
    id: string,
    tenantId: string,
    actor: { userId: string; email?: string },
  ): Promise<void> {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException(`Incident "${id}" not found`);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException(`Tenant "${tenantId}" not found`);

    const link = await this.prisma.incidentTenant.findUnique({
      where: { incidentId_tenantId: { incidentId: id, tenantId } },
    });
    if (link) return; // já afetado: nada muda, nada se audita

    await this.prisma.incidentTenant.create({
      data: { incidentId: id, tenantId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'incident.affected.add',
      resourceType: 'incident',
      resourceId: id,
      changes: { tenantId },
    });
  }

  /** Remove o tenant da área de impacto do incidente. */
  async removeAffected(
    id: string,
    tenantId: string,
    actor: { userId: string; email?: string },
  ): Promise<void> {
    const link = await this.prisma.incidentTenant.findUnique({
      where: { incidentId_tenantId: { incidentId: id, tenantId } },
    });
    if (!link) {
      throw new NotFoundException(
        `Tenant "${tenantId}" is not linked to incident "${id}"`,
      );
    }

    await this.prisma.incidentTenant.delete({
      where: { incidentId_tenantId: { incidentId: id, tenantId } },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'incident.affected.remove',
      resourceType: 'incident',
      resourceId: id,
      changes: { tenantId },
    });
  }
}
