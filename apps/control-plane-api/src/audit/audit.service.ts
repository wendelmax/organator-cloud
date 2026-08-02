import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  changes?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Registro de auditoria central. Escrita best-effort: nunca derruba a
 * operação principal se o registro de auditoria falhar.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          changes: (entry.changes ?? {}) as any,
          ip: entry.ip ?? null,
        },
      });
    } catch {
      // best-effort: auditoria não deve quebrar o fluxo principal
    }
  }
}
