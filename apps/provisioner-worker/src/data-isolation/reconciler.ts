import type {
  IsolationAdapter,
  IsolationContext,
  IsolationManifest,
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

/** IDs de recursos da origem: gravados no cutover espalhados em resourceState. */
function sourceResourceIds(state: Record<string, unknown>): Record<string, string> {
  if (state.resourceIds && typeof state.resourceIds === 'object') {
    return state.resourceIds as Record<string, string>;
  }
  const ids: Record<string, string> = {};
  for (const key of ['schema', 'database', 'role']) {
    if (typeof state[key] === 'string' && state[key]) ids[key] = state[key] as string;
  }
  return ids;
}

export async function reconcileDataIsolation(
  repository: IsolationRepository,
  adapter: IsolationAdapter,
  payload: ReconcilePayload,
  manifest: IsolationManifest,
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
        resourceIds: sourceResourceIds(snapshot.resourceState),
      } : null,
      sourceConnection: snapshot.encryptedConnection ? {
        id: (snapshot.resourceState.activeConnectionReference as string) || '',
        mode: snapshot.activeIsolation || 'SHARED',
      } : null,
      manifest,
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
