import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  PROVIDER_TYPES,
  SECRET_FIELDS,
  ProviderType,
  encryptSecret,
  decryptSecret,
  maskProviderData,
  testProviderConnection,
  TestConnectionResult,
} from '@organator/cloud-providers';
import {
  CreateProviderCredentialInput,
  UpdateProviderCredentialInput,
  ResolvedProviderCredential,
} from './providers.types';

type ProviderCredentialRecord = {
  encryptedData: unknown;
  [key: string]: unknown;
};

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(input: CreateProviderCredentialInput, actorId?: string | null) {
    const { type, name, secrets, config } = input;
    if (!type || !PROVIDER_TYPES.includes(type)) {
      throw new BadRequestException(`Invalid provider type: ${String(type)}`);
    }
    if (!name?.trim()) {
      throw new BadRequestException('Name is required');
    }

    const fields = SECRET_FIELDS[type];
    for (const field of fields) {
      const value = secrets?.[field];
      if (!value || !String(value).trim()) {
        throw new BadRequestException(`Missing secret: ${field}`);
      }
    }

    const encryptedData: Record<string, string> = {};
    for (const field of fields) {
      encryptedData[field] = encryptSecret(String(secrets[field]));
    }

    const credential = await this.prisma.providerCredential.create({
      data: {
        type,
        name: name.trim(),
        encryptedData,
        config: (config ?? {}) as any,
        createdBy: actorId ?? null,
      },
    });

    await this.auditService.record({
      actorId: actorId ?? null,
      action: 'provider_credential.created',
      resourceType: 'ProviderCredential',
      resourceId: credential.id,
      changes: { type, name: credential.name, secretFields: fields },
    });

    return this.sanitize(credential);
  }

  async list() {
    const all = await this.prisma.providerCredential.findMany({
      orderBy: [{ type: 'asc' }, { createdAt: 'desc' }],
    });
    return all.map((credential: ProviderCredentialRecord) =>
      this.sanitize(credential),
    );
  }

  async get(id: string) {
    const credential = await this.prisma.providerCredential.findUnique({
      where: { id },
    });
    if (!credential) {
      throw new NotFoundException('Provider credential not found');
    }
    return this.sanitize(credential);
  }

  /**
   * Atualização/rotação: apenas os segredos enviados são re-cifrados e
   * substituídos — os demais permanecem intactos (rotação sem downtime).
   */
  async update(
    id: string,
    input: UpdateProviderCredentialInput,
    actorId?: string | null,
  ) {
    const existing = await this.prisma.providerCredential.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Provider credential not found');
    }

    const type = existing.type as ProviderType;
    const encryptedData: Record<string, unknown> = {
      ...((existing.encryptedData ?? {}) as Record<string, unknown>),
    };
    const fields = SECRET_FIELDS[type];
    for (const field of fields) {
      if (input.secrets?.[field] !== undefined) {
        const value = String(input.secrets[field]);
        if (!value.trim()) {
          throw new BadRequestException(`Secret cannot be empty: ${field}`);
        }
        encryptedData[field] = encryptSecret(value);
      }
    }

    const updated = await this.prisma.providerCredential.update({
      where: { id },
      data: {
        ...(input.name !== undefined && {
          name: String(input.name).trim() || existing.name,
        }),
        encryptedData: encryptedData as any,
        ...(input.config !== undefined && { config: input.config as any }),
      },
    });

    await this.auditService.record({
      actorId: actorId ?? null,
      action: 'provider_credential.updated',
      resourceType: 'ProviderCredential',
      resourceId: id,
      changes: {
        type,
        name: updated.name,
        rotatedFields: fields.filter((f) => input.secrets?.[f] !== undefined),
      },
    });

    return this.sanitize(updated);
  }

  async remove(id: string, actorId?: string | null) {
    const existing = await this.prisma.providerCredential.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Provider credential not found');
    }
    await this.prisma.providerCredential.delete({ where: { id } });

    await this.auditService.record({
      actorId: actorId ?? null,
      action: 'provider_credential.deleted',
      resourceType: 'ProviderCredential',
      resourceId: id,
      changes: { type: existing.type, name: existing.name },
    });
  }

  /**
   * Teste de conexão: decifra os segredos e chama o provider.
   * O resultado nunca contém o segredo.
   */
  async testConnection(id: string): Promise<TestConnectionResult> {
    const credential = await this.prisma.providerCredential.findUnique({
      where: { id },
    });
    if (!credential) {
      throw new NotFoundException('Provider credential not found');
    }

    const secrets = this.decryptAll(credential.encryptedData as any);
    return testProviderConnection(
      credential.type as ProviderType,
      secrets,
      (credential.config ?? {}) as Record<string, unknown>,
    );
  }

  /**
   * Resolução usada no enqueue de jobs (BullMQ): decifra a credencial mais
   * recente do tipo e devolve config + segredos prontos para o worker usar.
   * Retorna null quando não há credencial configurada (worker cai para env/mock).
   */
  async resolveForDeploy(
    providerType: string,
  ): Promise<ResolvedProviderCredential | null> {
    if (!PROVIDER_TYPES.includes(providerType as ProviderType)) {
      return null;
    }
    const credential = await this.prisma.providerCredential.findFirst({
      where: { type: providerType },
      orderBy: { createdAt: 'desc' },
    });
    if (!credential) {
      return null;
    }
    return {
      type: credential.type as ProviderType,
      name: credential.name,
      config: (credential.config ?? {}) as Record<string, unknown>,
      secrets: this.decryptAll(credential.encryptedData as any),
    };
  }

  private decryptAll(
    encryptedData: Record<string, unknown>,
  ): Record<string, string> {
    const decrypted: Record<string, string> = {};
    for (const [key, value] of Object.entries(encryptedData ?? {})) {
      decrypted[key] = typeof value === 'string' ? decryptSecret(value) : '';
    }
    return decrypted;
  }

  /** Resposta de leitura: segredos sempre mascarados, nunca decifrados. */
  private sanitize(credential: ProviderCredentialRecord) {
    const { encryptedData, ...rest } = credential;
    const encryptedSecrets: Record<string, unknown> =
        encryptedData !== null &&
        typeof encryptedData === 'object' &&
        !Array.isArray(encryptedData)
        ? Object.fromEntries(Object.entries(encryptedData))
        : {};
    return {
      ...rest,
      secrets: maskProviderData(encryptedSecrets),
    };
  }
}
