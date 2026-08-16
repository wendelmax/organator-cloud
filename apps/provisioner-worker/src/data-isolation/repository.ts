import { PrismaClient } from '@organator/core-models';
import type { DataIsolationMode, IsolationPhase, StoredConnection } from '@organator/data-isolation';

export interface IsolationSnapshot {
  tenantId: string;
  generation: number;
  observedGeneration: number;
  desiredMode: DataIsolationMode;
  activeIsolation: DataIsolationMode | null;
  status: string;
  phase: IsolationPhase;
  resourceState: Record<string, unknown>;
  encryptedConnection: Record<string, unknown> | null;
  lastError: string | null;
}

export class IsolationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async load(tenantId: string): Promise<IsolationSnapshot | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { dataPlane: true },
    });
    if (!tenant || !tenant.dataPlane) return null;
    const dp = tenant.dataPlane;
    return {
      tenantId: tenant.id,
      generation: dp.generation,
      observedGeneration: dp.observedGeneration,
      desiredMode: tenant.dataIsolation as DataIsolationMode,
      activeIsolation: dp.activeIsolation as DataIsolationMode | null,
      status: dp.status,
      phase: dp.phase as IsolationPhase,
      resourceState: (dp.resourceState as Record<string, unknown>) || {},
      encryptedConnection: (dp.encryptedConnection as Record<string, unknown>) || null,
      lastError: dp.lastError,
    };
  }

  async withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    // Uses pg_advisory_xact_lock via Prisma raw query in a transaction
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        tenantId,
      );
      return fn();
    });
  }

  async checkpoint(input: {
    tenantId: string;
    generation: number;
    phase: IsolationPhase;
    resourceState?: Record<string, unknown>;
    lastError?: string | null;
  }): Promise<void> {
    await this.prisma.tenantDataPlane.update({
      where: { tenantId: input.tenantId },
      data: {
        phase: input.phase,
        status: input.phase === 'FAILED' ? 'FAILED' : 'RECONCILING',
        ...(input.resourceState ? { resourceState: input.resourceState as any } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      },
    });
  }

  async cutover(input: {
    tenantId: string;
    generation: number;
    mode: DataIsolationMode;
    storedConnection: StoredConnection;
    resourceState: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tenantDataPlane.update({
        where: { tenantId: input.tenantId },
        data: {
          activeIsolation: input.mode,
          observedGeneration: input.generation,
          status: 'READY',
          phase: 'READY',
          encryptedConnection: input.storedConnection.encryptedPayload as any,
          resourceState: {
            ...input.resourceState,
            activeConnectionReference: input.storedConnection.reference.id,
          } as any,
          completedAt: new Date(),
          lastError: null,
        },
      }),
    ]);
  }

  async fail(input: {
    tenantId: string;
    generation: number;
    phase: IsolationPhase;
    code: string;
    message: string;
  }): Promise<void> {
    await this.prisma.tenantDataPlane.update({
      where: { tenantId: input.tenantId },
      data: {
        status: 'FAILED',
        phase: input.phase,
        lastError: `[${input.code}] ${input.message}`,
      },
    });
  }

  async recordAudit(input: {
    tenantId: string;
    generation: number;
    deploymentId: string;
    action: string;
    changes: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: `data_isolation.${input.action}`,
          resourceType: 'TenantDataPlane',
          resourceId: input.tenantId,
          changes: input.changes as any,
        },
      });
    } catch {
      // Audit log failures are best-effort
    }
  }
}
