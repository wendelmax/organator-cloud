import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

describe('AuditController', () => {
  let controller: AuditController;
  let service: any;

  const mockAuditService = {
    findAll: jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 25,
      pages: 1,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: mockAuditService },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: jest.fn(() => true) },
        },
        { provide: RolesGuard, useValue: { canActivate: jest.fn(() => true) } },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('forwards query filters to the service', async () => {
    await controller.findAll({
      action: 'tenant.created',
      actorEmail: 'admin',
      resourceType: 'Tenant',
      from: '2026-01-01',
      to: '2026-02-01',
      page: 2,
      limit: 10,
    });

    expect(service.findAll).toHaveBeenCalledWith({
      action: 'tenant.created',
      actorEmail: 'admin',
      resourceType: 'Tenant',
      from: '2026-01-01',
      to: '2026-02-01',
      page: 2,
      limit: 10,
    });
  });

  it('returns the paginated result from the service', async () => {
    mockAuditService.findAll.mockResolvedValue({
      items: [{ id: 'a1' }],
      total: 1,
      page: 1,
      limit: 25,
      pages: 1,
    });

    const result = await controller.findAll({});

    expect(result).toEqual({
      items: [{ id: 'a1' }],
      total: 1,
      page: 1,
      limit: 25,
      pages: 1,
    });
  });
});
