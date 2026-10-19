import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StatusService } from './status.service';

describe('StatusService', () => {
  let service: StatusService;
  let prisma: any;

  const makePrisma = () => ({
    incident: {
      findMany: jest.fn(),
    },
  });

  beforeEach(async () => {
    prisma = makePrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatusService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<StatusService>(StatusService);
  });

  it('returns empty operational state when no public incidents in window', async () => {
    prisma.incident.findMany.mockResolvedValue([]);
    const res = await service.getStatus();
    expect(res.overall).toBe('operational');
    expect(res.components).toHaveLength(5);
    res.components.forEach((c) => {
      expect(c.status).toBe('operational');
      expect(c.activeIncidents).toBe(0);
    });
    expect(res.incidents).toHaveLength(0);
  });

  it('component critical open -> outage; overall outage', async () => {
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'i1',
        title: 'API caiu',
        severity: 'critical',
        status: 'investigating',
        component: 'api',
        startedAt: new Date('2026-10-19T00:00:00Z'),
        resolvedAt: null,
        updates: [
          {
            status: 'investigating',
            message: 'investigando',
            createdAt: new Date('2026-10-19T00:01:00Z'),
            internal: false,
          },
          {
            status: 'identified',
            message: 'interno',
            createdAt: new Date('2026-10-19T00:02:00Z'),
            internal: true,
          },
        ],
      },
    ]);
    const res = await service.getStatus();
    expect(res.overall).toBe('outage');
    const api = res.components.find((c) => c.component === 'api')!;
    expect(api.status).toBe('outage');
    expect(api.activeIncidents).toBe(1);
    expect(res.incidents).toHaveLength(1);
    expect(res.incidents[0].updates).toHaveLength(1);
    expect(res.incidents[0].updates[0].message).toBe('investigando');
    expect((res.incidents[0] as any).authorEmail).toBeUndefined();
  });

  it('major/minor -> degraded; overall degraded', async () => {
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'm1',
        title: 't',
        severity: 'major',
        status: 'monitoring',
        component: 'billing',
        startedAt: new Date(),
        resolvedAt: null,
        updates: [],
      },
      {
        id: 'm2',
        title: 't2',
        severity: 'minor',
        status: 'identified',
        component: 'dashboard',
        startedAt: new Date(),
        resolvedAt: null,
        updates: [],
      },
    ]);
    const res = await service.getStatus();
    expect(res.overall).toBe('degraded');
    expect(res.components.find((c) => c.component === 'billing')!.status).toBe(
      'degraded',
    );
    expect(
      res.components.find((c) => c.component === 'dashboard')!.status,
    ).toBe('degraded');
  });

  it('resolved within 30 days included; resolved > 30 days excluded', async () => {
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'w',
        title: 'w',
        severity: 'minor',
        status: 'resolved',
        component: 'api',
        startedAt: new Date(Date.now() - 864e5),
        resolvedAt: new Date(Date.now() - 864e5),
        updates: [],
      },
      {
        id: 'o',
        title: 'o',
        severity: 'minor',
        status: 'resolved',
        component: 'api',
        startedAt: new Date(Date.now() - 40 * 864e5),
        resolvedAt: new Date(Date.now() - 40 * 864e5),
        updates: [],
      },
    ]);
    const res = await service.getStatus();
    const ids = res.incidents.map((i) => i.id);
    expect(ids).toContain('w');
    expect(ids).not.toContain('o');
  });

  it('open incidents always included even if old', async () => {
    prisma.incident.findMany.mockResolvedValue([
      {
        id: 'oldopen',
        title: 'x',
        severity: 'minor',
        status: 'investigating',
        component: 'api',
        startedAt: new Date(Date.now() - 60 * 864e5),
        resolvedAt: null,
        updates: [],
      },
    ]);
    const res = await service.getStatus();
    expect(res.incidents.map((i) => i.id)).toContain('oldopen');
  });
});
