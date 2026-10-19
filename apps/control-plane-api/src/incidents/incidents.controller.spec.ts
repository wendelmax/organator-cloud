import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { IncidentsController } from './incidents.controller';

describe('IncidentsController (#110)', () => {
  let svc: any;
  let controller: IncidentsController;

  // O ator vem sempre do JWT: o corpo da requisição nunca é fonte de autoria.
  const req = {
    user: {
      userId: 'admin',
      email: 'ops@acme.com',
      role: 'PLATFORM_ADMIN',
      tenantId: 'platform',
    },
  };

  const methods = [
    'list',
    'create',
    'get',
    'update',
    'addUpdate',
    'addAffected',
    'removeAffected',
  ] as const;

  beforeEach(() => {
    svc = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [], total: 0, page: 1, pages: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'i1' }),
      get: jest.fn().mockResolvedValue({ id: 'i1' }),
      update: jest.fn().mockResolvedValue({ id: 'i1' }),
      addUpdate: jest.fn().mockResolvedValue({ id: 'u1' }),
      addAffected: jest.fn().mockResolvedValue(undefined),
      removeAffected: jest.fn().mockResolvedValue(undefined),
    };
    controller = new IncidentsController(svc);
  });

  it('is restricted to PLATFORM_ADMIN with JwtAuthGuard + RolesGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, IncidentsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    const proto = IncidentsController.prototype as unknown as Record<
      string,
      object
    >;
    // Todas as sete rotas são exclusivas do admin da plataforma.
    for (const m of methods) {
      expect(Reflect.getMetadata(ROLES_KEY, proto[m])).toEqual([
        'PLATFORM_ADMIN',
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, proto[m])).not.toContain('SUPPORT');
    }
  });

  it('passes the JWT actor (userId/email) to service.create and never trusts body authorEmail', async () => {
    const body = {
      title: 'API indisponível',
      authorEmail: 'attacker@evil.io',
    } as any;
    await controller.create(req, body);
    // O ator de auditoria é sempre o JWT, mesmo com outro autor no corpo.
    expect(svc.create).toHaveBeenCalledWith(expect.anything(), {
      userId: 'admin',
      email: 'ops@acme.com',
    });
    expect(svc.create.mock.calls[0][1].email).not.toBe('attacker@evil.io');
  });

  it('takes the timeline author from the JWT actor (userId/email) only', async () => {
    const body = {
      status: 'identified',
      message: 'Causa raiz identificada',
      authorEmail: 'attacker@evil.io',
    } as any;
    await controller.addUpdate(req, 'i1', body);
    expect(svc.addUpdate).toHaveBeenCalledWith('i1', body, {
      userId: 'admin',
      email: 'ops@acme.com',
    });
    expect(svc.addUpdate.mock.calls[0][2].email).not.toBe('attacker@evil.io');
  });

  it('maps POST /affected tenantId from body to service.addAffected(id, tenantId, actor)', async () => {
    await expect(
      controller.addAffected(req, 'i1', { tenantId: 't9' }),
    ).resolves.toEqual({ linked: true });
    expect(svc.addAffected).toHaveBeenCalledWith('i1', 't9', {
      userId: 'admin',
      email: 'ops@acme.com',
    });
  });

  it('passes the JWT actor to update and removeAffected', async () => {
    await controller.update(req, 'i1', { status: 'resolved' });
    await expect(controller.removeAffected(req, 'i1', 't9')).resolves.toEqual({
      removed: true,
    });
    expect(svc.update).toHaveBeenCalledWith(
      'i1',
      { status: 'resolved' },
      { userId: 'admin', email: 'ops@acme.com' },
    );
    expect(svc.removeAffected).toHaveBeenCalledWith('i1', 't9', {
      userId: 'admin',
      email: 'ops@acme.com',
    });
  });

  it('maps list query filters and pagination to the service', async () => {
    await controller.list('investigating', 'critical', 'api', '2', '50');
    expect(svc.list).toHaveBeenCalledWith({
      status: 'investigating',
      severity: 'critical',
      component: 'api',
      page: 2,
      limit: 50,
    });
  });

  it('propagates NotFoundException from the service untouched', async () => {
    svc.get.mockRejectedValue(new NotFoundException('Incident "i1" not found'));
    await expect(controller.get('i1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.get('i1')).rejects.toThrow(
      'Incident "i1" not found',
    );
  });
});
