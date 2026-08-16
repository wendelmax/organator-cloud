import { InfrastructureProvider, ProvisioningSpec, ResourceState } from './types.js';

export class TerraformDriver implements InfrastructureProvider {
  readonly name = 'TERRAFORM';

  async prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }> {
    const cleanSlug = spec.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const databaseId = `tf_db_${cleanSlug}`;
    const user = `tf_user_${cleanSlug.slice(0, 10)}`;
    const pass = `tf_pass_${spec.tenantId.slice(0, 8)}`;
    const connectionUrl = `postgresql://${user}:${pass}@localhost:5432/${databaseId}`;
    return { databaseId, connectionUrl };
  }

  async prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }> {
    return { networkId: `tf_net_${spec.slug}` };
  }

  async configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }> {
    return { dnsRecord: `${spec.slug}.tf.organator.cloud` };
  }

  async deprovision(_spec: ProvisioningSpec, _state: ResourceState): Promise<void> {}
}
