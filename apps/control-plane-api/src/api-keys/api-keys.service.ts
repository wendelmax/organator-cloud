import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import {
  API_KEY_PREFIX,
  ApiKeyScope,
  ValidatedApiKey,
  normalizeScopes,
} from './api-keys.types';
import { ForbiddenException } from '@nestjs/common';

/** Estados do tenant que invalidam a API key imediatamente (#46). */
const BLOCKED_TENANT_STATES = ['suspended', 'offboarding', 'deleted'];

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  tenantId?: string;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
}

type ApiKeyRecord = {
  hash?: unknown;
  scopes?: unknown;
  [key: string]: unknown;
};

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /** Gera o token bruto (sk_...) e persiste apenas o hash sha256. */
  async create(input: CreateApiKeyInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('Name is required');
    }
    if (input.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: input.tenantId },
      });
      if (!tenant) {
        throw new NotFoundException('Tenant not found');
      }
    }

    const scopes = normalizeScopes(input.scopes);
    const token = this.generateToken();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: input.name.trim(),
        hash: this.hashToken(token),
        prefix: token.slice(0, 12),
        scopes: scopes,
        tenantId: input.tenantId ?? null,
        createdBy: input.createdBy ?? null,
        expiresAt,
      },
    });

    await this.auditService.record({
      actorId: input.createdBy ?? null,
      action: 'api_key.created',
      resourceType: 'ApiKey',
      resourceId: apiKey.id,
      changes: {
        name: apiKey.name,
        scopes,
        tenantId: input.tenantId ?? null,
        expiresAt,
      },
    });

    // Token bruto apenas nesta resposta — não é armazenável depois.
    return {
      apiKey: this.sanitize(apiKey),
      token,
    };
  }

  async list(tenantId?: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((key: ApiKeyRecord) => this.sanitize(key));
  }

  async get(id: string, tenantId?: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, ...(tenantId ? { tenantId } : {}) } });
    if (!key) {
      throw new NotFoundException('API key not found');
    }
    return this.sanitize(key);
  }

  async update(
    id: string,
    data: {
      name?: string;
      scopes?: string[];
      expiresAt?: string | Date | null;
      tenantId?: string | null;
    },
    actorId?: string | null,
    tenantId?: string,
  ) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }
    if (tenantId && existing.tenantId !== tenantId) throw new ForbiddenException('API key belongs to another tenant');

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.scopes !== undefined && {
          scopes: normalizeScopes(data.scopes),
        }),
        ...(data.expiresAt !== undefined && {
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        }),
        ...(data.tenantId !== undefined && { tenantId: data.tenantId }),
      },
    });

    await this.auditService.record({
      actorId: actorId ?? null,
      action: 'api_key.updated',
      resourceType: 'ApiKey',
      resourceId: id,
      changes: { name: data.name, scopes: data.scopes },
    });

    return this.sanitize(updated);
  }

  /** Revogação imediata: remove o registro, matando o token na hora. */
  async delete(id: string, actorId?: string | null, tenantId?: string) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }
    if (tenantId && existing.tenantId !== tenantId) throw new ForbiddenException('API key belongs to another tenant');
    await this.prisma.apiKey.delete({ where: { id } });

    await this.auditService.record({
      actorId: actorId ?? null,
      action: 'api_key.deleted',
      resourceType: 'ApiKey',
      resourceId: id,
      changes: { name: existing.name },
    });
  }

  /**
   * Validação principal usada pelo ApiKeyStrategy (autenticação):
   * - prefixo sk_
   * - hash existe e não está revogado/expirado
   * - tenant não está suspenso/offboarding/deleted (#46)
   * Atualiza lastUsedAt.
   */
  async validate(token: string): Promise<ValidatedApiKey | null> {
    if (!token || !token.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    const key = await this.prisma.apiKey.findUnique({
      where: { hash: this.hashToken(token) },
      include: { tenant: { select: { state: true } } },
    });
    if (!key) {
      return null;
    }
    if (key.expiresAt && key.expiresAt < new Date()) {
      return null;
    }
    const state = key.tenant?.state || 'active';
    if (BLOCKED_TENANT_STATES.includes(state)) {
      return null;
    }

    await this.prisma.apiKey
      .update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    return {
      id: key.id,
      name: key.name,
      scopes: (key.scopes ?? []) as string[],
      tenantId: key.tenantId,
      expiresAt: key.expiresAt,
      tenant: key.tenant,
    };
  }

  /**
   * Resolução leve usada pelo TenantStateGuard (sem efeitos colaterais)
   * para aplicar read-only/bloqueio de estado em requisições de API key.
   */
  async resolveTenantId(token: string): Promise<string | null> {
    if (!token || !token.startsWith(API_KEY_PREFIX)) {
      return null;
    }
    const key = await this.prisma.apiKey.findUnique({
      where: { hash: this.hashToken(token) },
      select: {
        tenantId: true,
        expiresAt: true,
        tenant: { select: { state: true } },
      },
    });
    if (!key) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;
    if (!key.tenantId) return null;
    const state = key.tenant?.state || 'active';
    if (BLOCKED_TENANT_STATES.includes(state)) return null;
    return key.tenantId;
  }

  private generateToken(): string {
    return `${API_KEY_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private sanitize(key: ApiKeyRecord) {
    const { hash: _hash, ...rest } = key;
    void _hash;
    return {
      ...rest,
      scopes: (key.scopes ?? []) as ApiKeyScope[],
    };
  }
}
