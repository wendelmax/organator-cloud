import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class AWSDriver implements InfrastructureProvider {
  readonly name = 'AWS';

  constructor(private readonly region = 'us-east-1') {}

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const cleanSlug = spec.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const databaseId = `org-rds-${cleanSlug}`;
    const user = `user_${cleanSlug.slice(0, 10)}`;
    const pass = `pass_${spec.tenantId.slice(0, 8)}`;
    const connectionUrl = `postgresql://${user}:${pass}@${databaseId}.${this.region}.rds.amazonaws.com:5432/${cleanSlug}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `sg-org-${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    return { dnsRecord: `${spec.slug}.organator.cloud` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {}
}
