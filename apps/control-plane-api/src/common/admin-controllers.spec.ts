import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ApiKeysController } from '../api-keys/api-keys.controller';
import { ProvidersController } from '../providers/providers.controller';
import { BillingController } from '../billing/billing.controller';
import { BillingPlansController } from '../billing/billing-plans.controller';
import { PlacementController } from '../placement/placement.controller';
import { DocsController } from '../docs/docs.controller';

const admin = { user: { userId: 'admin', role: 'PLATFORM_ADMIN', tenantId: 'platform' } };
const owner = { user: { userId: 'owner', role: 'OWNER', tenantId: 't1' } };

describe('ApiKeysController', () => {
  let svc: any;
  let controller: ApiKeysController;

  beforeEach(() => {
    svc = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    controller = new ApiKeysController(svc);
  });

  it('is restricted to PLATFORM_ADMIN and OWNER', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ApiKeysController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ApiKeysController)).toEqual(['PLATFORM_ADMIN', 'OWNER']);
  });

  it('requires a name', async () => {
    await expect(controller.create(owner, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an OWNER always creates keys for their own tenant', async () => {
    await controller.create(owner, { name: 'ci', tenantId: 'someone-else', scopes: ['services:read'] });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', createdBy: 'owner' }));
  });

  it('a PLATFORM_ADMIN may create keys for any tenant or platform-wide', async () => {
    await controller.create(admin, { name: 'ops', tenantId: 't9' });
    await controller.create(admin, { name: 'global' });
    expect(svc.create.mock.calls.map((c: any[]) => c[0].tenantId)).toEqual(['t9', undefined]);
  });

  it('scopes list/get/update/delete to the owner tenant', async () => {
    await controller.list(owner);
    await controller.get('k1', owner);
    await controller.update(owner, 'k1', { name: 'n', tenantId: 'steal' });
    await expect(controller.remove(owner, 'k1')).resolves.toEqual({ deleted: true });

    expect(svc.list).toHaveBeenCalledWith('t1');
    expect(svc.get).toHaveBeenCalledWith('k1', 't1');
    expect(svc.update).toHaveBeenCalledWith('k1', expect.objectContaining({ tenantId: undefined }), 'owner', 't1');
    expect(svc.delete).toHaveBeenCalledWith('k1', 'owner', 't1');
  });

  it('does not restrict the platform admin', async () => {
    await controller.list(admin);
    await controller.update(admin, 'k1', { tenantId: 't2' });
    expect(svc.list).toHaveBeenCalledWith(undefined);
    expect(svc.update).toHaveBeenCalledWith('k1', expect.objectContaining({ tenantId: 't2' }), 'admin', undefined);
  });
});

describe('ProvidersController', () => {
  let svc: any;
  let controller: ProvidersController;

  beforeEach(() => {
    svc = {
      create: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
      testConnection: jest.fn(),
      createProfile: jest.fn(),
      listProfiles: jest.fn(),
    };
    controller = new ProvidersController(svc);
  });

  it('is restricted to PLATFORM_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ProvidersController)).toEqual(['PLATFORM_ADMIN']);
    expect(Reflect.getMetadata(GUARDS_METADATA, ProvidersController)).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('requires type and name', async () => {
    await expect(controller.create(admin, { type: 'AWS' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(admin, { name: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('defaults secrets/config and records the actor', async () => {
    await controller.create(admin, { type: 'AWS', name: 'prod' });
    expect(svc.create).toHaveBeenCalledWith({ type: 'AWS', name: 'prod', secrets: {}, config: {} }, 'admin');
  });

  it('delegates the remaining routes', async () => {
    await controller.list();
    await controller.get('p1');
    await controller.update(admin, 'p1', { name: 'n' });
    await expect(controller.remove(admin, 'p1')).resolves.toEqual({ deleted: true });
    await controller.testConnection('p1');
    await controller.createProfile(admin, { name: 'p', type: 'AWS', credentialId: 'c' });
    await controller.listProfiles(admin);

    expect(svc.update).toHaveBeenCalledWith('p1', { name: 'n', secrets: undefined, config: undefined }, 'admin');
    expect(svc.remove).toHaveBeenCalledWith('p1', 'admin');
    expect(svc.testConnection).toHaveBeenCalledWith('p1');
    expect(svc.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, config: {}, credentialId: 'c' }),
      'admin',
    );
    expect(svc.listProfiles).toHaveBeenCalledWith('platform');
  });
});

describe('BillingController', () => {
  it('always uses the caller tenant and restricts roles per route', async () => {
    const svc = { createPortalSession: jest.fn(), getSubscription: jest.fn(), createUpgradeSession: jest.fn() };
    const controller = new BillingController(svc as any);

    await controller.createPortalSession(owner, 'https://app/return');
    await controller.getSubscription(owner);
    await controller.upgrade(owner, { plan: 'pro', returnUrl: 'r' });

    expect(svc.createPortalSession).toHaveBeenCalledWith('t1', 'https://app/return');
    expect(svc.getSubscription).toHaveBeenCalledWith('t1');
    expect(svc.createUpgradeSession).toHaveBeenCalledWith('t1', 'pro', 'r', 'owner');

    const roles = (m: keyof BillingController) => Reflect.getMetadata(ROLES_KEY, BillingController.prototype[m]);
    expect(roles('createPortalSession')).not.toContain('MEMBER');
    expect(roles('upgrade')).not.toContain('MEMBER');
    expect(roles('getSubscription')).toContain('MEMBER');
  });
});

describe('BillingPlansController', () => {
  it('keeps listing public and mutations admin-only', async () => {
    const svc = {
      listActive: jest.fn(),
      listAll: jest.fn(),
      getBySlug: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    const controller = new BillingPlansController(svc as any);
    const req = { user: { userId: 'admin', email: 'a@x.io' }, ip: '1.2.3.4' };
    const ctx = { actorId: 'admin', actorEmail: 'a@x.io', ip: '1.2.3.4' };

    controller.listActive();
    controller.getBySlug('pro');
    controller.create(req, { slug: 'pro' } as any);
    controller.update(req, 'pro', { price: 1 } as any);
    controller.deactivate(req, 'pro');

    expect(svc.getBySlug).toHaveBeenCalledWith('pro');
    expect(svc.create).toHaveBeenCalledWith({ slug: 'pro' }, ctx);
    expect(svc.update).toHaveBeenCalledWith('pro', { price: 1 }, ctx);
    expect(svc.deactivate).toHaveBeenCalledWith('pro', ctx);

    const p = BillingPlansController.prototype;
    expect(Reflect.getMetadata(GUARDS_METADATA, p.listActive)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, p.getBySlug)).toBeUndefined();
    for (const m of [p.listAll, p.create, p.update, p.deactivate]) {
      expect(Reflect.getMetadata(ROLES_KEY, m)).toEqual(['PLATFORM_ADMIN']);
      expect(Reflect.getMetadata(GUARDS_METADATA, m)).toEqual([JwtAuthGuard, RolesGuard]);
    }
  });
});

describe('PlacementController', () => {
  it('always operates on the caller tenant', async () => {
    const svc = { setPolicy: jest.fn(), planMigration: jest.fn(), validate: jest.fn() };
    const controller = new PlacementController(svc as any);

    controller.setPolicy(owner, { residencyRequired: 'EU' });
    controller.planMigration(owner, { toRegionId: 'eu-1' });
    controller.validate(owner, { provider: 'AWS', region: 'eu-west-1' });

    expect(svc.setPolicy).toHaveBeenCalledWith('t1', { residencyRequired: 'EU' }, 'owner');
    expect(svc.planMigration).toHaveBeenCalledWith('t1', 'eu-1', 'owner');
    expect(svc.validate).toHaveBeenCalledWith({ tenantId: 't1', provider: 'AWS', region: 'eu-west-1' });
  });
});

describe('DocsController', () => {
  it('creates docs in the caller tenant and exposes only public docs anonymously', async () => {
    const svc = { createDoc: jest.fn(), getAllPublicDocs: jest.fn(), getDocsByService: jest.fn(), toggleVisibility: jest.fn() };
    const controller = new DocsController(svc as any);
    const body = { microserviceId: 's', title: 't', version: '1', openApiSpec: '{}' };

    await controller.create(owner, body);
    await controller.getPublic();
    await controller.getByService('s');
    await controller.toggleVisibility('d', true);

    expect(svc.createDoc).toHaveBeenCalledWith(body, 't1');
    expect(svc.toggleVisibility).toHaveBeenCalledWith('d', true);
    expect(Reflect.getMetadata(GUARDS_METADATA, DocsController.prototype.getPublic)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, DocsController.prototype.toggleVisibility)).toBeDefined();
  });
});
