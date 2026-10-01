import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MfaPolicyService } from './mfa-policy.service';

describe('MfaPolicyService — rules', () => {
  let prisma: any;
  let audit: any;
  let service: MfaPolicyService;
  const owner = { userId: 'u1', role: 'OWNER', email: 'o@acme.com' };

  beforeEach(() => {
    prisma = {
      tenantSecurityPolicy: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn((args) => Promise.resolve({ tenantId: args.where.tenantId, ...args.create })),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new MfaPolicyService(prisma, audit);
  });

  it('defaults to optional when the tenant has no policy', async () => {
    await expect(service.get('t1')).resolves.toEqual({ tenantId: 't1', mfaMode: 'optional', requiredRoles: [] });
    await expect(service.requiresMfa('t1', 'OWNER')).resolves.toBe(false);
  });

  it('required_for_all applies to every role', async () => {
    prisma.tenantSecurityPolicy.findUnique.mockResolvedValue({ mfaMode: 'required_for_all' });
    await expect(service.requiresMfa('t1', 'MEMBER')).resolves.toBe(true);
  });

  it('required_for_roles applies only to listed roles', async () => {
    prisma.tenantSecurityPolicy.findUnique.mockResolvedValue({ mfaMode: 'required_for_roles', requiredRoles: ['OWNER', 'ADMIN'] });
    await expect(service.requiresMfa('t1', 'ADMIN')).resolves.toBe(true);
    await expect(service.requiresMfa('t1', 'MEMBER')).resolves.toBe(false);
  });

  it('tolerates malformed requiredRoles', async () => {
    prisma.tenantSecurityPolicy.findUnique.mockResolvedValue({ mfaMode: 'required_for_roles', requiredRoles: 'OWNER' });
    await expect(service.requiresMfa('t1', 'OWNER')).resolves.toBe(false);
  });

  it('trusts MFA already performed at the IdP', async () => {
    prisma.tenantSecurityPolicy.findUnique.mockResolvedValue({ mfaMode: 'required_for_all' });
    await expect(service.requiresMfa('t1', 'OWNER', true)).resolves.toBe(false);
    await expect(service.requiresMfa('t1', 'OWNER', false)).resolves.toBe(true);
  });

  describe('update', () => {
    it.each(['MEMBER', 'BILLING', 'API_KEY'])('forbids %s from changing the policy', async (role) => {
      await expect(service.update('t1', { userId: 'u', role }, { mfaMode: 'optional' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.tenantSecurityPolicy.upsert).not.toHaveBeenCalled();
    });

    it('rejects unknown modes', async () => {
      await expect(service.update('t1', owner, { mfaMode: 'always' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores requiredRoles only for required_for_roles', async () => {
      await service.update('t1', owner, { mfaMode: 'required_for_all', requiredRoles: ['OWNER'] });
      expect(prisma.tenantSecurityPolicy.upsert.mock.calls[0][0].create.requiredRoles).toEqual([]);

      await service.update('t1', owner, { mfaMode: 'required_for_roles', requiredRoles: ['OWNER'] });
      expect(prisma.tenantSecurityPolicy.upsert.mock.calls[1][0].create.requiredRoles).toEqual(['OWNER']);

      await service.update('t1', owner, { mfaMode: 'required_for_roles' });
      expect(prisma.tenantSecurityPolicy.upsert.mock.calls[2][0].create.requiredRoles).toEqual([]);
    });

    it('audits changes with the actor', async () => {
      await service.update('t1', owner, { mfaMode: 'required_for_all' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.mfa_policy_changed', actorId: 'u1', actorEmail: 'o@acme.com', resourceId: 't1' }),
      );
    });
  });
});
