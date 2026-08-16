import type {
  IsolationAdapter,
  IsolationContext,
  IsolationPhase,
  TargetResources,
  DataIsolationMode,
} from '@organator/data-isolation';
import { sanitizeIsolationError } from '@organator/data-isolation';
import { IsolationRepository, IsolationSnapshot } from './repository.js';

export interface ReconcilePayload {
  apiVersion: string;
  tenantId: string;
  generation: number;
  desiredMode: DataIsolationMode;
  actorId?: string;
  deploymentId?: string;
}

export type ReconcileResultStatus = 'SUCCESS' | 'STALE' | 'FAILED';

export async function reconcileDataIsolation(
  repository: IsolationRepository,
  adapter: IsolationAdapter,
  payload: ReconcilePayload,
): Promise<{ status: ReconcileResultStatus; message?: string }> {
  return repository.withTenantLock(payload.tenantId, async () => {
    const snapshot = await repository.load(payload.tenantId);
    if (!snapshot) {
      return { status: 'FAILED', message: 'Tenant data plane not found' };
    }

    // Stale job check: if payload generation is older than snapshot generation, skip
    if (payload.generation !== snapshot.generation) {
      return { status: 'STALE', message: `Job generation ${payload.generation} != current generation ${snapshot.generation}` };
    }

    const context: IsolationContext = {
      tenantId: payload.tenantId,
      generation: payload.generation,
      sourceMode: snapshot.activeIsolation,
      targetMode: payload.desiredMode,
      source: snapshot.activeIsolation ? {
        mode: snapshot.activeIsolation,
        database: (snapshot.resourceState.database as string) || '',
        schema: (snapshot.resourceState.schema as string) || 'public',
        role: (snapshot.resourceState.role as string) || '',
        resourceIds: (snapshot.resourceState.resourceIds as Record<string, string>) || {},
      } : null,
      sourceConnection: snapshot.encryptedConnection ? {
        id: (snapshot.resourceState.activeConnectionReference as string) || '',
        mode: snapshot.activeIsolation || 'SHARED',
      } : null,
      manifest: {
        apiVersion: 'organator.io/v1alpha1',
        product: 'organator-cloud',
        tenantScopedTables: [
          { schema: 'public', table: 'users', tenantColumn: 'tenant_id', primaryKey: 'id' },
        ],
        async applyMigrations() {},
        async validate() {
          return { rowCounts: {}, checksums: {}, validatedAt: new Date().toISOString() };
        },
      },
      resolveConnection: async () => '',
      storeConnection: async (input) => ({
        reference: { id: `${input.mode}:${payload.tenantId}:${payload.generation}`, mode: input.mode },
        encryptedPayload: { url: input.url },
      }),
    };

    let target: TargetResources | null = null;
    let phase: IsolationPhase = 'PREPARE';

    try {
      // Phase 1: PREPARE
      phase = 'PREPARE';
      await repository.checkpoint({ tenantId: payload.tenantId, generation: payload.generation, phase });

      // Phase 2: PROVISION_TARGET
      phase = 'PROVISION_TARGET';
      target = await adapter.prepareTarget(context);
      await repository.checkpoint({
        tenantId: payload.tenantId,
        generation: payload.generation,
        phase,
        resourceState: { ...snapshot.resourceState, ...target.resourceIds, mode: target.mode },
      });

      // Phase 3: APPLY_MIGRATIONS
      phase = 'APPLY_MIGRATIONS';
      await adapter.applyMigrations(context, target);
      await repository.checkpoint({ tenantId: payload.tenantId, generation: payload.generation, phase });

      // Phase 4: COPY
      phase = 'COPY';
      await adapter.copyData(context, target);
      await repository.checkpoint({ tenantId: payload.tenantId, generation: payload.generation, phase });

      // Phase 5: VALIDATE
      phase = 'VALIDATE';
      await adapter.validate(context, target);
      await repository.checkpoint({ tenantId: payload.tenantId, generation: payload.generation, phase });

      // Phase 6: CUTOVER
      phase = 'CUTOVER';
      const activation = await adapter.activate(context, target);
      await repository.cutover({
        tenantId: payload.tenantId,
        generation: payload.generation,
        mode: target.mode,
        storedConnection: activation.storedConnection,
        resourceState: { ...snapshot.resourceState, ...target.resourceIds, mode: target.mode, cleanupAfter: activation.cleanupAfter },
      });

      await repository.recordAudit({
        tenantId: payload.tenantId,
        generation: payload.generation,
        deploymentId: payload.deploymentId || '',
        action: 'cutover_completed',
        changes: { sourceMode: snapshot.activeIsolation, targetMode: target.mode },
      });

      return { status: 'SUCCESS' };
    } catch (error) {
      const sanitized = sanitizeIsolationError(error);

      // On failure before cutover, compensate target
      if (phase !== 'CUTOVER' && target) {
        try {
          await adapter.compensate(context, target);
        } catch {
          // Best effort compensation
        }
      }

      await repository.fail({
        tenantId: payload.tenantId,
        generation: payload.generation,
        phase,
        code: sanitized.code,
        message: sanitized.message,
      });

      await repository.recordAudit({
        tenantId: payload.tenantId,
        generation: payload.generation,
        deploymentId: payload.deploymentId || '',
        action: 'reconciliation_failed',
        changes: { phase, code: sanitized.code, message: sanitized.message },
      });

      return { status: 'FAILED', message: sanitized.message };
    }
  });
}
