import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  DataIsolationModeValue,
  IsolationOverrideInput,
  DataIsolationView,
  toDataIsolationView,
  planDefaultIsolation,
  isValidIsolationMode,
  DATA_ISOLATION_MODES,
} from './data-isolation.types';

@Injectable()
export class DataIsolationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Optional() @InjectQueue('provisioner') private readonly provisionerQueue?: Queue,
  ) {}

  async getStatus(tenantId: string): Promise<DataIsolationView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { dataPlane: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return toDataIsolationView(tenant);
  }

  async setOverride(
    tenantId: string,
    input: IsolationOverrideInput,
    actorId: string,
  ): Promise<DataIsolationView> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: { dataPlane: true },
      });
      if (!tenant) throw new NotFoundException('Tenant not found');

      let desiredMode: DataIsolationModeValue;
      let overridden: boolean;

      if (input.mode === null) {
        // Clear override, reapply plan default
        const billingPlan = await tx.billingPlan.findUnique({
          where: { slug: tenant.plan.toLowerCase() },
        });
        desiredMode = billingPlan?.defaultDataIsolation as DataIsolationModeValue ?? planDefaultIsolation(tenant.plan);
        overridden = false;
      } else {
        if (!isValidIsolationMode(input.mode)) {
          throw new BadRequestException(
            `Invalid isolation mode. Allowed: ${DATA_ISOLATION_MODES.join(', ')}`,
          );
        }
        // Check if destructive (downgrade)
        const currentMode = tenant.dataIsolation;
        const modeOrder = { SHARED: 0, SCHEMA: 1, DATABASE: 2 };
        if (modeOrder[input.mode] < modeOrder[currentMode as keyof typeof modeOrder]) {
          if (!input.confirmDestructive) {
            throw new BadRequestException(
              'Destructive isolation change requires confirmDestructive flag',
            );
          }
        }
        desiredMode = input.mode;
        overridden = true;
      }

      // If mode unchanged, return current state
      if (desiredMode === tenant.dataIsolation && overridden === tenant.dataIsolationOverridden) {
        return toDataIsolationView(tenant);
      }

      await tx.tenant.update({
        where: { id: tenantId },
        data: { dataIsolation: desiredMode, dataIsolationOverridden: overridden },
      });

      const dataPlane = await tx.tenantDataPlane.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status: 'PENDING',
          phase: 'PREPARE',
          generation: 1,
        },
        update: {
          generation: { increment: 1 },
          status: 'PENDING',
          phase: 'PREPARE',
          lastError: null,
        },
      });

      const updatedTenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: { dataPlane: true },
      });

      // Enqueue reconciliation after transaction
      const generation = dataPlane.generation;
      const jobId = `data-isolation:${tenantId}:generation:${generation}`;
      if (this.provisionerQueue) {
        await this.provisionerQueue.add(
          'reconcile-data-isolation',
          {
            apiVersion: 'organator.io/v1alpha1',
            tenantId,
            generation,
            desiredMode,
            actorId,
          },
          {
            jobId,
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
          },
        );
      }

      await this.auditService.record({
        actorId,
        action: 'tenant.data_isolation.override_changed',
        resourceType: 'Tenant',
        resourceId: tenantId,
        changes: {
          mode: desiredMode,
          overridden: String(overridden),
          generation: String(generation),
        },
      });

      return toDataIsolationView(updatedTenant!);
    });
  }

  async reconcile(tenantId: string, actorId: string): Promise<{ deploymentId?: string; generation: number }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { dataPlane: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const generation = tenant.dataPlane?.generation ?? 1;
    const jobId = `data-isolation:${tenantId}:generation:${generation}`;

    // Check for existing deployment with this idempotency key
    const existing = await this.prisma.deployment.findUnique({
      where: { idempotencyKey: jobId },
    });
    if (existing) {
      return { deploymentId: existing.id, generation };
    }

    if (this.provisionerQueue) {
      await this.provisionerQueue.add(
        'reconcile-data-isolation',
        {
          apiVersion: 'organator.io/v1alpha1',
          tenantId,
          generation,
          desiredMode: tenant.dataIsolation,
          actorId,
        },
        {
          jobId,
          attempts: 5,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
    }

    await this.auditService.record({
      actorId,
      action: 'tenant.data_isolation.reconcile_requested',
      resourceType: 'Tenant',
      resourceId: tenantId,
      changes: {
        mode: tenant.dataIsolation,
        generation: String(generation),
      },
    });

    return { generation };
  }

  async applyPlanDefault(tenantId: string, newPlan: string, actorId: string): Promise<DataIsolationView> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { dataPlane: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // If overridden, keep the override
    if (tenant.dataIsolationOverridden) {
      return toDataIsolationView(tenant);
    }

    const billingPlan = await this.prisma.billingPlan.findUnique({
      where: { slug: newPlan.toLowerCase() },
    });
    const desiredMode = billingPlan?.defaultDataIsolation as DataIsolationModeValue ?? planDefaultIsolation(newPlan);

    if (desiredMode === tenant.dataIsolation) {
      return toDataIsolationView(tenant);
    }

    return this.setOverride(tenantId, { mode: desiredMode, confirmDestructive: true }, actorId);
  }
}
