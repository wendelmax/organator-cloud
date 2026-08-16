export interface ProvisioningSpec {
  tenantId: string;
  slug: string;
  isolationMode: 'SHARED' | 'SCHEMA' | 'DATABASE';
  environment: string;
  region?: string;
  customDomain?: string;
}

export interface ResourceState {
  databaseId?: string;
  databaseUrl?: string;
  networkId?: string;
  dnsRecord?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface InfrastructureProvider {
  name: string;
  prepareDatabase(spec: ProvisioningSpec): Promise<{ databaseId: string; connectionUrl: string }>;
  prepareNetwork(spec: ProvisioningSpec): Promise<{ networkId: string }>;
  configureDNS(spec: ProvisioningSpec): Promise<{ dnsRecord: string }>;
  deprovision(spec: ProvisioningSpec, state: ResourceState): Promise<void>;
}
