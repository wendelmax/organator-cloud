import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class DockerDriver implements InfrastructureProvider {
  readonly name = 'DOCKER';

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const cleanSlug = spec.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const databaseId = `org_db_${cleanSlug}`;
    const user = `user_${cleanSlug.slice(0, 10)}`;
    const pass = `pass_${spec.tenantId.slice(0, 8)}`;
    const port = 5432;
    const host = process.env.DOCKER_HOST_NAME || 'localhost';
    
    const connectionUrl = `postgresql://${user}:${pass}@${host}:${port}/${databaseId}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `org_net_${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    const domain = process.env.WILDCARD_DOMAIN || 'organator.local';
    return { dnsRecord: `${spec.slug}.${domain}` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {}
}
