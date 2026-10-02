import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
  const human = { user: { userId: 'u1', tenantId: 't-human', role: 'OWNER' } };
  const platformAdmin = {
    user: { userId: 'adm', tenantId: 't-platform', role: 'PLATFORM_ADMIN' },
  };
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

    it('platform keys and platform admins may use any tenant', async () => {
      await controller.findByTenant(platformKey, 't-x');
      await controller.findByTenant(platformAdmin, 't-y');
      expect(svc.getServicesByTenant.mock.calls).toEqual([['t-x'], ['t-y']]);
    });
  });

  describe('tenant scoping for users', () => {
    it('a user only reads the services of the active tenant', async () => {
      await controller.findByTenant(human, 't-human');
      expect(svc.getServicesByTenant).toHaveBeenCalledWith('t-human');
      await expect(controller.findByTenant(human, 't-other')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('a user cannot create services in another tenant', async () => {
      await expect(
        controller.create(human, {
          tenantId: 't-other',
          name: 'a',
          cloudProvider: 'VERCEL',
          repository: 'r',
        } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(svc.createService).not.toHaveBeenCalled();
    });

    it('deploys, lists deployments and streams logs within the user tenant', async () => {
      svc.assertDeploymentInScope = jest.fn();
      await controller.triggerDeploy(human, 'svc-1', {
        environment: 'staging',
      });
      await controller.getDeployments(human, 'svc-1');
      await controller.streamLogs(human, 'dep-1');

      expect(svc.triggerDeploy).toHaveBeenCalledWith(
        'svc-1',
        'staging',
        't-human',
      );
      expect(svc.getDeploymentsByService).toHaveBeenCalledWith(
        'svc-1',
        't-human',
      );
      expect(svc.assertDeploymentInScope).toHaveBeenCalledWith(
        'dep-1',
        't-human',
      );
      expect(svc.streamDeploymentLogs).toHaveBeenCalledWith('dep-1');
    });

    it('platform admins are not restricted to a tenant', async () => {
      await controller.getDeployments(platformAdmin, 'svc-1');
      expect(svc.getDeploymentsByService).toHaveBeenCalledWith('svc-1', null);
    });

    it('a tenant-bound API key cannot create services in another tenant', async () => {
      await controller.create(tenantKey, {
        tenantId: 't-other',
        name: 'api',
        cloudProvider: 'AWS',
        repository: 'r',
      } as any);
      expect(svc.createService).toHaveBeenCalledWith(
        't-key',
        'api',
        'AWS',
        'r',
        {},
      );
    });
  });

  describe('create', () => {
    it('prefers repositoryUrl over repository', async () => {
      await controller.create(human, {
        tenantId: 't-human',
        name: 'a',
        cloudProvider: 'VERCEL',
        repositoryUrl: 'url',
        repository: 'legacy',
      } as any);
      expect(svc.createService).toHaveBeenCalledWith(
        't-human',
        'a',
        'VERCEL',
        'url',
        {},
      );
    });

    it('stores the image and host of a VPS service (DOCKER_VPS is an alias)', async () => {
      await controller.create(human, {
        name: 'api',
        cloudProvider: 'DOCKER_VPS',
        repository: 'r',
        image: 'ghcr.io/acme/api:1',
        vpsHost: 'deploy@10.0.0.5',
      } as any);
      expect(svc.createService).toHaveBeenCalledWith(
        't-human',
        'api',
        'VPS',
        'r',
        {
          image: 'ghcr.io/acme/api:1',
          vpsHost: 'deploy@10.0.0.5',
        },
      );
    });

    it('requires an image for VPS services', async () => {
      await expect(
        controller.create(human, {
          name: 'api',
          cloudProvider: 'VPS',
          repository: 'r',
        } as any),
      ).rejects.toThrow(/image is required/);
    });

    it('requires a repository', async () => {
      await expect(
        controller.create(human, {
          tenantId: 't1',
          name: 'a',
          cloudProvider: 'VERCEL',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('passes the requested environment to triggerDeploy', async () => {
    await controller.triggerDeploy(human, 'svc-1', { environment: 'staging' });
    await controller.triggerDeploy(human, 'svc-1', undefined as any);
    expect(svc.triggerDeploy.mock.calls).toEqual([
      ['svc-1', 'staging', 't-human'],
      ['svc-1', undefined, 't-human'],
    ]);
  });

  describe('authorization metadata', () => {
    const proto = ServicesController.prototype as unknown as Record<
      string,
      object
    >;
    const guards = (m: keyof ServicesController) =>
      Reflect.getMetadata(GUARDS_METADATA, proto[m]);
    const scopes = (m: keyof ServicesController) =>
      Reflect.getMetadata(SCOPES_KEY, proto[m]);
    const quota = (m: keyof ServicesController) =>
      Reflect.getMetadata(QUOTA_KEY, proto[m]);

    it('protects read routes with JWT + scope', () => {
      expect(guards('findByTenant')).toEqual([JwtAuthGuard, ScopeGuard]);
      expect(scopes('findByTenant')).toEqual(['services:read']);
      expect(scopes('getDeployments')).toEqual(['services:read']);
      // O stream de logs era público.
      expect(guards('streamLogs')).toEqual([JwtAuthGuard, ScopeGuard]);
      expect(scopes('streamLogs')).toEqual(['services:read']);
    });

    it('enforces quotas on deploy and create', () => {
      expect(guards('triggerDeploy')).toEqual([
        JwtAuthGuard,
        ScopeGuard,
        QuotaGuard,
      ]);
      expect(quota('triggerDeploy')).toBe('DEPLOYMENT');
      expect(scopes('triggerDeploy')).toEqual(['services:deploy']);
      expect(guards('create')).toEqual([JwtAuthGuard, ScopeGuard, QuotaGuard]);
      expect(quota('create')).toBe('MICROSERVICE');
      expect(scopes('create')).toEqual(['services:write']);
    });
  });
});
