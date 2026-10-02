import { GUARDS_METADATA } from '@nestjs/common/constants';
import { QuotaGuard } from './quota.guard';
import { QUOTA_KEY } from './quota.decorator';
import { TenantsController } from '../tenants/tenants.controller';
import { InvitationsController } from '../tenants/invitations.controller';
import { DocsController } from '../docs/docs.controller';
import { DomainsController } from '../domains/domains.controller';
import { ServicesController } from '../services/services.controller';

/** Toda rota que cria um recurso cobrado pelo plano passa pelo QuotaGuard. */
describe('plan quotas on resource-creating routes', () => {
  const routes: [string, any, string, string][] = [
    ['POST /v1/services', ServicesController, 'create', 'MICROSERVICE'],
    [
      'POST /v1/services/:id/deploy',
      ServicesController,
      'triggerDeploy',
      'DEPLOYMENT',
    ],
    ['POST /v1/tenants/members', TenantsController, 'addMember', 'SEATS'],
    ['POST /v1/tenant-invitations', InvitationsController, 'create', 'SEATS'],
    ['POST /v1/docs', DocsController, 'create', 'APIS'],
    ['POST /v1/domains', DomainsController, 'create', 'DOMAINS'],
  ];

  it.each(routes)(
    '%s checks the %s quota',
    (_route, controller, method, resource) => {
      const handler = controller.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        QuotaGuard,
      );
      expect(Reflect.getMetadata(QUOTA_KEY, handler)).toBe(resource);
    },
  );
});
