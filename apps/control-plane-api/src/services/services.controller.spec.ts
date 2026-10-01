import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ServicesController } from './services.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ScopeGuard } from '../api-keys/scope.guard';
import { QuotaGuard } from '../saas/quota.guard';
import { SCOPES_KEY } from '../api-keys/scopes.decorator';
import { QUOTA_KEY } from '../saas/quota.decorator';

describe('ServicesController', () => {
  let svc: any;
  let controller: ServicesController;
  const human = { user: { userId: 'u1', tenantId: 't-human' } };
  const tenantKey = { user: { apiKeyAuth: true, tenantId: 't-key' } };
  const platformKey = { user: { apiKeyAuth: true } };

  beforeEach(() => {
    svc = {
      getServicesByTenant: jest.fn(),
      getDeploymentsByService: jest.fn(),
      triggerDeploy: jest.fn(),
      createService: jest.fn(),
      streamDeploymentLogs: jest.fn(),
    };
    controller = new ServicesController(svc);
  });

  describe('tenant scoping for API keys', () => {
    it('a tenant-bound API key cannot list another tenant services', async () => {
      await controller.findByTenant(tenantKey, 't-other');
      expect(svc.getServicesByTenant).toHaveBeenCalledWith('t-key');
    });

    it('platform keys and humans use the requested tenant', async () => {
      await controller.findByTenant(platformKey, 't-x');
      await controller.findByTenant(human, 't-y');
      expect(svc.getServicesByTenant.mock.calls).toEqual([['t-x'], ['t-y']]);
    });

    it('a tenant-bound API key cannot create services in another tenant', async () => {
      await controller.create(tenantKey, { tenantId: 't-other', name: 'api', cloudProvider: 'AWS', repository: 'r' } as any);
      expect(svc.createService).toHaveBeenCalledWith('t-key', 'api', 'AWS', 'r');
    });
  });

  describe('create', () => {
    it('prefers repositoryUrl over repository', async () => {
      await controller.create(human, { tenantId: 't1', name: 'a', cloudProvider: 'VERCEL', repositoryUrl: 'url', repository: 'legacy' } as any);
      expect(svc.createService).toHaveBeenCalledWith('t1', 'a', 'VERCEL', 'url');
    });

    it('requires a repository', async () => {
      await expect(
        controller.create(human, { tenantId: 't1', name: 'a', cloudProvider: 'VERCEL' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('passes the requested environment to triggerDeploy', async () => {
    await controller.triggerDeploy('svc-1', { environment: 'staging' });
    await controller.triggerDeploy('svc-1', undefined as any);
    expect(svc.triggerDeploy.mock.calls).toEqual([['svc-1', 'staging'], ['svc-1', undefined]]);
  });

  describe('authorization metadata', () => {
    const proto = ServicesController.prototype;
    const guards = (m: keyof ServicesController) => Reflect.getMetadata(GUARDS_METADATA, proto[m]);
    const scopes = (m: keyof ServicesController) => Reflect.getMetadata(SCOPES_KEY, proto[m]);
    const quota = (m: keyof ServicesController) => Reflect.getMetadata(QUOTA_KEY, proto[m]);

    it('protects read routes with JWT + scope', () => {
      expect(guards('findByTenant')).toEqual([JwtAuthGuard, ScopeGuard]);
      expect(scopes('findByTenant')).toEqual(['services:read']);
      expect(scopes('getDeployments')).toEqual(['services:read']);
    });

    it('enforces quotas on deploy and create', () => {
      expect(guards('triggerDeploy')).toEqual([JwtAuthGuard, ScopeGuard, QuotaGuard]);
      expect(quota('triggerDeploy')).toBe('DEPLOYMENT');
      expect(scopes('triggerDeploy')).toEqual(['services:deploy']);
      expect(guards('create')).toEqual([JwtAuthGuard, ScopeGuard, QuotaGuard]);
      expect(quota('create')).toBe('MICROSERVICE');
      expect(scopes('create')).toEqual(['services:write']);
    });
  });
});
