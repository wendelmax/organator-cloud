import { ConflictException } from '@nestjs/common';
import { PlacementService } from './placement.service';

describe('PlacementService', () => {
  it('rejects a region outside the tenant policy before provisioning', async () => {
    const prisma = {
      tenantPlacementPolicy: { findUnique: jest.fn().mockResolvedValue({ regionId: 'eu-1', allowedProviders: [] }) },
      regionCatalog: { findUnique: jest.fn().mockResolvedValue({ id: 'us-1', status: 'available', capacity: 2, residency: 'US' }) },
    };
    const service = new PlacementService(prisma as never, { record: jest.fn() } as never);
    await expect(service.validate({ tenantId: 't1', provider: 'AWS', region: 'us-east-1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unavailable regions', async () => {
    const prisma = { tenantPlacementPolicy: { findUnique: jest.fn().mockResolvedValue(null) }, regionCatalog: { findUnique: jest.fn().mockResolvedValue({ status: 'degraded', capacity: 0 }) } };
    const service = new PlacementService(prisma as never, { record: jest.fn() } as never);
    await expect(service.validate({ tenantId: 't1', provider: 'AWS', region: 'us-east-1' })).rejects.toThrow('indisponível');
  });
});
