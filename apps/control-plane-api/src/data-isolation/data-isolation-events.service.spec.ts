import { Test } from '@nestjs/testing';
import { DataIsolationEventsService } from './data-isolation-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('DataIsolationEventsService', () => {
  let service: DataIsolationEventsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      deployment: { findFirst: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        DataIsolationEventsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DataIsolationEventsService);
  });

  it('rejects subscription if deployment does not belong to tenant', async () => {
    prisma.deployment.findFirst.mockResolvedValue(null);

    await expect(
      service.stream({ tenantId: 'tenant-a', deploymentId: 'dep-b' }),
    ).rejects.toThrow(NotFoundException);
  });
});
