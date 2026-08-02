import { Test, TestingModule } from '@nestjs/testing';
import { TenantLifecycleService } from './tenant-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuditService } from '../audit/audit.service';
import {
  BadRequestException,
  NotFoundException,
  HttpException,
} from '@nestjs/common';

describe('TenantLifecycleService', () => {
  let service: TenantLifecycleService;

  const mockEntitlements = { bust: jest.fn() };
  const mockAudit = { record: jest.fn() };
  const mockPrisma = {
    tenant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const baseTenant = {
    id: 'tenant-1',
    state: 'active',
    graceEndsAt: null,
    suspendedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantLifecycleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EntitlementsService, useValue: mockEntitlements },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<TenantLifecycleService>(TenantLifecycleService);
  });

  describe('transition', () => {
    it('should apply a valid transition and keep status in sync', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(baseTenant);
      mockPrisma.tenant.update.mockResolvedValue({
        ...baseTenant,
        state: 'past_due',
        status: 'active',
        graceEndsAt: new Date(),
      });

      const graceEndsAt = new Date();
      const result = await service.transition('tenant-1', 'past_due', {
        graceEndsAt,
        reason: 'invoice.payment_failed',
      });

      expect(result.state).toBe('past_due');
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        data: expect.objectContaining({
          state: 'past_due',
          status: 'active',
          stateChangedAt: expect.any(Date),
          graceEndsAt,
        }),
      });
      expect(mockEntitlements.bust).toHaveBeenCalledWith('tenant-1');
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.state_change',
          resourceId: 'tenant-1',
          changes: expect.objectContaining({
            from: 'active',
            to: 'past_due',
            reason: 'invoice.payment_failed',
          }),
        }),
      );
    });

    it('should reject invalid transitions', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        ...baseTenant,
        state: 'active',
      });

      await expect(service.transition('tenant-1', 'deleted')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should be idempotent for same-state transitions', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        ...baseTenant,
        state: 'past_due',
      });

      await service.transition('tenant-1', 'past_due');

      expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.state_reasserted' }),
      );
    });

    it('should throw NotFoundException for missing tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.transition('missing', 'active')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map suspended legacy status', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(baseTenant);
      mockPrisma.tenant.update.mockResolvedValue({
        ...baseTenant,
        state: 'suspended',
        status: 'suspended',
        suspendedAt: new Date(),
      });

      const result = await service.markSuspended('tenant-1');

      expect(result.status).toBe('suspended');
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tenant-1' },
          data: expect.objectContaining({
            state: 'suspended',
            status: 'suspended',
            suspendedAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  describe('getState', () => {
    it('should return suspended when grace period expired', async () => {
      const past = new Date(Date.now() - 1000);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        state: 'past_due',
        graceEndsAt: past,
      });

      const state = await service.getState('tenant-1');
      expect(state).toBe('suspended');
    });

    it('should return past_due while within grace period', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        state: 'past_due',
        graceEndsAt: future,
      });

      const state = await service.getState('tenant-1');
      expect(state).toBe('past_due');
    });
  });

  describe('assertAccess', () => {
    it('should allow reads for past_due tenant', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        state: 'past_due',
        graceEndsAt: future,
      });

      await expect(
        service.assertAccess('tenant-1', 'GET'),
      ).resolves.toBeUndefined();
    });

    it('should block writes for past_due tenant with paywall code', async () => {
      const future = new Date(Date.now() + 60 * 60 * 1000);
      mockPrisma.tenant.findUnique.mockResolvedValue({
        state: 'past_due',
        graceEndsAt: future,
      });

      try {
        await service.assertAccess('tenant-1', 'POST');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(403);
        expect((err as HttpException).getResponse()).toMatchObject({
          code: 'TENANT_PAST_DUE',
        });
      }
    });

    it('should block all access for suspended tenant', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        state: 'suspended',
        graceEndsAt: null,
      });

      try {
        await service.assertAccess('tenant-1', 'GET');
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getResponse()).toMatchObject({
          code: 'TENANT_SUSPENDED',
        });
      }
    });
  });
});
