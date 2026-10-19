import { NotFoundException } from '@nestjs/common';
import { IncidentsService } from './incidents.service';

describe('IncidentsService (#110)', () => {
  let incidents: Map<string, any>;
  let updates: Map<string, any>;
  let links: Map<string, any>;
  let tenants: Map<string, any>;
  let prisma: any;
  let audit: { record: jest.Mock };
  let service: IncidentsService;

  const actor = { userId: 'u1', email: 'oncall@acme.com' };

  /** Ignora chaves com undefined: para o Prisma são "não informado". */
  const clean = (data: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );

  /**
   * Espelha os defaults do schema (model Incident): severity, status,
   * component, public, source, alertKey/assignee/postmortem/resolvedAt null e
   * updatedAt. startedAt NÃO tem default no mock — quem preenche é o service.
   */
  const seed = (data: Record<string, any> = {}) => {
    const row = {
      id: `inc-${incidents.size + 1}`,
      updatedAt: new Date(),
      severity: 'minor',
      status: 'investigating',
      component: 'api',
      public: true,
      source: 'manual',
      alertKey: null,
      assigneeEmail: null,
      postmortemUrl: null,
      resolvedAt: null,
      ...data,
    };
    incidents.set(row.id, row);
    return row;
  };

  /** Where mínimo: igualdade simples e `{ not: valor }`. */
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([field, condition]) => {
      if (
        condition &&
        typeof condition === 'object' &&
        !(condition instanceof Date)
      ) {
        return 'not' in condition ? row[field] !== condition.not : true;
      }
      return row[field] === condition;
    });

  beforeEach(() => {
    incidents = new Map();
    updates = new Map();
    links = new Map();
    tenants = new Map([['t1', { id: 't1', name: 'Acme' }]]);
    prisma = {
      incident: {
        create: jest.fn(async ({ data }: any) => seed(clean(data))),
        findUnique: jest.fn(async ({ where, include }: any) => {
          const row = incidents.get(where.id);
          if (!row) return null;
          if (!include) return row;
          return {
            ...row,
            updates: [...updates.values()]
              .filter((u: any) => u.incidentId === row.id)
              .sort(
                (a: any, b: any) =>
                  a.createdAt.getTime() - b.createdAt.getTime(),
              ),
            affected: [...links.values()]
              .filter((l: any) => l.incidentId === row.id)
              .sort(
                (a: any, b: any) => a.addedAt.getTime() - b.addedAt.getTime(),
              ),
          };
        }),
        findFirst: jest.fn(
          async ({ where }: any) =>
            [...incidents.values()].find((row) => matches(row, where)) ?? null,
        ),
        findMany: jest.fn(
          async ({ where, skip = 0, take, orderBy, include }: any) => {
            let rows = [...incidents.values()].filter((row) =>
              matches(row, where),
            );
            if (orderBy?.startedAt) {
              const direction = orderBy.startedAt === 'desc' ? -1 : 1;
              rows = rows.sort(
                (a, b) =>
                  direction * (a.startedAt.getTime() - b.startedAt.getTime()),
              );
            }
            rows = rows.slice(
              skip,
              take === undefined ? undefined : skip + take,
            );
            // _count.select.updates → contagem de atualizações por incidente.
            if (include?._count?.select?.updates) {
              rows = rows.map((row) => ({
                ...row,
                _count: {
                  updates: [...updates.values()].filter(
                    (u: any) => u.incidentId === row.id,
                  ).length,
                },
              }));
            }
            return rows;
          },
        ),
        count: jest.fn(
          async ({ where }: any) =>
            [...incidents.values()].filter((row) => matches(row, where)).length,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = incidents.get(where.id);
          Object.assign(row, clean(data));
          row.updatedAt = new Date();
          return row;
        }),
      },
      incidentUpdate: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `upd-${updates.size + 1}`,
            createdAt: new Date(),
            ...clean(data),
          };
          updates.set(row.id, row);
          return row;
        }),
      },
      incidentTenant: {
        findUnique: jest.fn(async ({ where }: any) => {
          const { incidentId, tenantId } = where.incidentId_tenantId;
          return links.get(`${incidentId}:${tenantId}`) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { addedAt: new Date(), ...clean(data) };
          links.set(`${row.incidentId}:${row.tenantId}`, row);
          return row;
        }),
        delete: jest.fn(async ({ where }: any) => {
          const { incidentId, tenantId } = where.incidentId_tenantId;
          const key = `${incidentId}:${tenantId}`;
          const row = links.get(key);
          links.delete(key);
          return row;
        }),
      },
      tenant: {
        findUnique: jest.fn(
          async ({ where }: any) => tenants.get(where.id) ?? null,
        ),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new IncidentsService(prisma, audit as any);
  });

  it('create stores a manual incident with defaults (severity=minor, status=investigating, public=true) and audits incident.create', async () => {
    const incident = await service.create({ title: 'API lenta' }, actor);

    expect(incident).toMatchObject({
      title: 'API lenta',
      severity: 'minor',
      status: 'investigating',
      public: true,
      source: 'manual',
      resolvedAt: null,
    });
    expect(incident.startedAt).toBeInstanceOf(Date);
    expect(incidents.size).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.create',
        resourceType: 'incident',
        resourceId: incident.id,
        actorId: 'u1',
        actorEmail: 'oncall@acme.com',
      }),
    );
  });

  it('dedup: creating with an alertKey of an OPEN incident returns the existing incident without creating another', async () => {
    const first = await service.create(
      { title: 'Alerta 5xx', alertKey: 'alert-1', source: 'alert:5xx' },
      actor,
    );
    audit.record.mockClear(); // o dedup não deve auditar de novo
    const second = await service.create(
      { title: 'Alerta 5xx (nova tentativa)', alertKey: 'alert-1' },
      actor,
    );

    expect(second.id).toBe(first.id);
    expect(incidents.size).toBe(1);
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.incident.findFirst).toHaveBeenCalledWith({
      where: { alertKey: 'alert-1', status: { not: 'resolved' } },
    });
  });

  it('dedup: creating with an alertKey of a RESOLVED incident creates a new incident', async () => {
    const first = await service.create(
      { title: 'Alerta 5xx', alertKey: 'alert-1' },
      actor,
    );
    await service.update(first.id, { status: 'resolved' }, actor);
    expect(incidents.get(first.id).alertKey).toBeNull(); // resolve libera a chave

    const second = await service.create(
      { title: 'Alerta 5xx de novo', alertKey: 'alert-1' },
      actor,
    );

    expect(second.id).not.toBe(first.id);
    expect(second.alertKey).toBe('alert-1');
    expect(incidents.size).toBe(2);
  });

  it('update to status=resolved fills resolvedAt, clears alertKey, and audits incident.update', async () => {
    const incident = await service.create(
      { title: 'Alerta 5xx', alertKey: 'alert-1' },
      actor,
    );
    audit.record.mockClear();

    const resolved = await service.update(
      incident.id,
      { status: 'resolved' },
      actor,
    );

    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    expect(resolved.alertKey).toBeNull();
    expect(incidents.get(incident.id).resolvedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.update',
        resourceType: 'incident',
        resourceId: incident.id,
        actorId: 'u1',
        actorEmail: 'oncall@acme.com',
      }),
    );
  });

  it('reopening a resolved incident clears resolvedAt', async () => {
    const incident = await service.create(
      { title: 'Alerta 5xx', alertKey: 'alert-1' },
      actor,
    );
    await service.update(incident.id, { status: 'resolved' }, actor);
    expect(incidents.get(incident.id).resolvedAt).toBeInstanceOf(Date);

    const reopened = await service.update(
      incident.id,
      { status: 'monitoring' },
      actor,
    );

    expect(reopened.status).toBe('monitoring');
    expect(reopened.resolvedAt).toBeNull();
    expect(incidents.get(incident.id).resolvedAt).toBeNull();
  });

  it('create with status=resolved fills resolvedAt and clears alertKey', async () => {
    const incident = await service.create(
      {
        title: 'Alerta 5xx já resolvido',
        alertKey: 'alert-1',
        status: 'resolved',
      },
      actor,
    );

    expect(incident.status).toBe('resolved');
    expect(incident.resolvedAt).toBeInstanceOf(Date);
    expect(incident.alertKey).toBeNull();
    expect(incidents.get(incident.id).resolvedAt).toBeInstanceOf(Date);
  });

  it('addUpdate persists internal=true notes with authorEmail taken from the actor', async () => {
    const incident = await service.create({ title: 'Alerta 5xx' }, actor);

    const update = await service.addUpdate(
      incident.id,
      {
        status: 'identified',
        message: 'Causa raiz identificada',
        internal: true,
      },
      actor,
    );

    expect(update).toMatchObject({
      incidentId: incident.id,
      status: 'identified',
      message: 'Causa raiz identificada',
      internal: true,
      authorEmail: 'oncall@acme.com',
    });
    expect(updates.size).toBe(1);
  });

  it('addUpdate audits incident.update.add with the actorId from the actor', async () => {
    const incident = await service.create({ title: 'Alerta 5xx' }, actor);
    audit.record.mockClear();

    await service.addUpdate(
      incident.id,
      { status: 'monitoring', message: 'Estável' },
      actor,
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.update.add',
        resourceType: 'incident',
        resourceId: incident.id,
        actorId: 'u1',
        actorEmail: 'oncall@acme.com',
      }),
    );
  });

  it('addAffected throws NotFoundException for an unknown tenant and is idempotent for a linked one', async () => {
    const incident = await service.create({ title: 'Alerta 5xx' }, actor);

    await expect(
      service.addAffected(incident.id, 'tenant-404', actor),
    ).rejects.toThrow(NotFoundException);

    await service.addAffected(incident.id, 't1', actor);
    await service.addAffected(incident.id, 't1', actor);

    expect(links.size).toBe(1);
    expect([...links.values()][0]).toMatchObject({
      incidentId: incident.id,
      tenantId: 't1',
    });
    const affectedAudits = audit.record.mock.calls.filter(
      ([entry]) => entry.action === 'incident.affected.add',
    );
    expect(affectedAudits).toHaveLength(1);
    expect(affectedAudits[0][0]).toMatchObject({
      actorId: 'u1',
      actorEmail: 'oncall@acme.com',
    });
  });

  it('removeAffected throws NotFoundException when the tenant is not linked', async () => {
    const incident = await service.create({ title: 'Alerta 5xx' }, actor);

    await expect(
      service.removeAffected(incident.id, 't1', actor),
    ).rejects.toThrow(NotFoundException);
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'incident.affected.remove' }),
    );

    await service.addAffected(incident.id, 't1', actor);
    await expect(
      service.removeAffected(incident.id, 't1', actor),
    ).resolves.toBeUndefined();
    expect(links.size).toBe(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incident.affected.remove',
        resourceType: 'incident',
        resourceId: incident.id,
        actorId: 'u1',
        actorEmail: 'oncall@acme.com',
      }),
    );

    await expect(
      service.removeAffected(incident.id, 't1', actor),
    ).rejects.toThrow(NotFoundException);
  });

  it('get throws NotFoundException for an unknown id', async () => {
    await expect(service.get('inc-404')).rejects.toThrow(NotFoundException);
  });

  it('get returns the incident with its timeline and affected tenants', async () => {
    const incident = await service.create({ title: 'Alerta 5xx' }, actor);
    await service.addUpdate(
      incident.id,
      { status: 'investigating', message: 'Investigando' },
      actor,
    );
    await service.addAffected(incident.id, 't1', actor);

    const fetched = await service.get(incident.id);

    expect(fetched.id).toBe(incident.id);
    expect(fetched.updates).toHaveLength(1);
    expect(fetched.updates[0]).toMatchObject({
      message: 'Investigando',
      authorEmail: 'oncall@acme.com',
    });
    expect(fetched.affected).toHaveLength(1);
    expect(fetched.affected[0].tenantId).toBe('t1');
  });

  it('update, addUpdate and addAffected throw NotFoundException for an unknown incident', async () => {
    await expect(
      service.update('inc-404', { status: 'resolved' }, actor),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.addUpdate(
        'inc-404',
        { status: 'investigating', message: 'x' },
        actor,
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(service.addAffected('inc-404', 't1', actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('list filters by status and paginates', async () => {
    seed({
      title: 'aberto 1',
      status: 'investigating',
      startedAt: new Date('2026-01-01'),
    });
    seed({
      title: 'aberto 2',
      status: 'investigating',
      startedAt: new Date('2026-01-02'),
    });
    seed({
      title: 'aberto 3',
      status: 'investigating',
      startedAt: new Date('2026-01-03'),
    });
    seed({
      title: 'resolvido',
      status: 'resolved',
      startedAt: new Date('2026-01-10'),
    });
    seed({
      title: 'identificado',
      status: 'identified',
      startedAt: new Date('2026-01-11'),
    });

    const page1 = await service.list({
      status: 'investigating',
      page: 1,
      limit: 2,
    });
    expect(page1).toMatchObject({ total: 3, page: 1, pages: 2 });
    expect(page1.items.map((item) => item.title)).toEqual([
      'aberto 3',
      'aberto 2',
    ]);

    const page2 = await service.list({
      status: 'investigating',
      page: 2,
      limit: 2,
    });
    expect(page2).toMatchObject({ total: 3, page: 2, pages: 2 });
    expect(page2.items.map((item) => item.title)).toEqual(['aberto 1']);
  });

  it('list items carry the updates count via _count.updates (Updates column in the panel)', async () => {
    const incident = await service.create({ title: 'Com timeline' }, actor);
    await service.addUpdate(
      incident.id,
      { status: 'investigating', message: 'Investigando' },
      actor,
    );
    await service.addUpdate(
      incident.id,
      { status: 'monitoring', message: 'Estável' },
      actor,
    );
    const other = await service.create({ title: 'Sem timeline' }, actor);

    const page = await service.list({});

    expect(prisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { _count: { select: { updates: true } } },
      }),
    );

    const withCount = page.items.find((item) => item.id === incident.id);
    const withoutCount = page.items.find((item) => item.id === other.id);

    expect(withCount?._count.updates).toBe(2);
    // Sem atualizações, a contagem existe e é zero (coluna pode exibi-la).
    expect(withoutCount?._count.updates).toBe(0);
  });
});
