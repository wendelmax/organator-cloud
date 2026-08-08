import { MfaPolicyService } from './mfa-policy.service';

describe('MfaPolicyService', () => {
  it('defaults missing policies to optional and resolves role requirements', async () => {
    const prisma = {
      tenantSecurityPolicy: { findUnique: jest.fn().mockResolvedValue({ tenantId: 't1', mfaMode: 'required_for_roles', requiredRoles: ['OWNER'] }) },
    };
    const service = new MfaPolicyService(prisma as never, { record: jest.fn() } as never);
    await expect(service.requiresMfa('t1', 'OWNER')).resolves.toBe(true);
    await expect(service.requiresMfa('t1', 'MEMBER')).resolves.toBe(false);
    await expect(service.requiresMfa('t1', 'OWNER', true)).resolves.toBe(false);
  });

  it('rejects policy writes by non-admin actors', async () => {
    const service = new MfaPolicyService({ tenantSecurityPolicy: { upsert: jest.fn() } } as never, { record: jest.fn() } as never);
    await expect(service.update('t1', { userId: 'u1', role: 'MEMBER' }, { mfaMode: 'required_for_all' })).rejects.toThrow('Somente');
  });
});
