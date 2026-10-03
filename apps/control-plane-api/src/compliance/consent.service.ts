import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Finalidades obrigatórias para usar a plataforma. */
export const REQUIRED_PURPOSES = ['terms', 'privacy'] as const;
/** Finalidades opcionais: o titular liga e desliga no centro de preferências. */
export const OPTIONAL_PURPOSES = ['marketing', 'analytics'] as const;
export type ConsentPurpose =
  (typeof REQUIRED_PURPOSES)[number] | (typeof OPTIONAL_PURPOSES)[number];
const ALL_PURPOSES: string[] = [...REQUIRED_PURPOSES, ...OPTIONAL_PURPOSES];

/** Versões vigentes dos documentos; mudar a versão pede novo aceite. */
export function documentVersions(env: NodeJS.ProcessEnv = process.env) {
  return {
    terms: env.TERMS_VERSION?.trim() || '2026-10',
    privacy: env.PRIVACY_POLICY_VERSION?.trim() || '2026-10',
  };
}

/** Versão registrada por finalidade: as opcionais seguem a política de privacidade. */
const versionFor = (purpose: string, versions = documentVersions()) =>
  purpose === 'terms' ? versions.terms : versions.privacy;

const subjectOf = (
  user: { userId?: string; apiKeyAuth?: boolean } | undefined,
) => {
  if (!user?.userId || user.apiKeyAuth) {
    throw new ForbiddenException('Available to signed-in users only');
  }
  return user.userId;
};

/**
 * Consentimentos versionados e revogáveis (LGPD/GDPR, #107). Cada concessão é
 * um registro com versão, IP e user agent; revogar fecha o registro ativo. O
 * histórico completo fica disponível ao titular (exportação) e ao admin.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Estado atual: o que está aceito, o que falta e as versões vigentes. */
  async status(user: { userId?: string; apiKeyAuth?: boolean }) {
    const userId = subjectOf(user);
    const versions = documentVersions();
    const active = await this.prisma.consent.findMany({
      where: { userId, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    const current = (purpose: string) =>
      active.find(
        (c) =>
          c.purpose === purpose && c.version === versionFor(purpose, versions),
      );
    return {
      versions,
      required: REQUIRED_PURPOSES.filter((p) => !current(p)),
      preferences: Object.fromEntries(
        OPTIONAL_PURPOSES.map((p) => [
          p,
          Boolean(active.find((c) => c.purpose === p)),
        ]),
      ),
      consents: active.map(({ purpose, version, grantedAt }) => ({
        purpose,
        version,
        grantedAt,
      })),
    };
  }

  /** Concede (na versão vigente) ou revoga uma finalidade. */
  async update(
    user: { userId?: string; apiKeyAuth?: boolean; email?: string },
    input: { purpose?: string; granted?: boolean },
    context: { ip?: string | null; userAgent?: string | null } = {},
  ) {
    const userId = subjectOf(user);
    const purpose = String(input?.purpose ?? '');
    if (
      !ALL_PURPOSES.includes(purpose) ||
      typeof input?.granted !== 'boolean'
    ) {
      throw new BadRequestException(
        `purpose must be one of ${ALL_PURPOSES.join(', ')} and granted a boolean`,
      );
    }
    if (
      !input.granted &&
      (REQUIRED_PURPOSES as readonly string[]).includes(purpose)
    ) {
      // Sem termos/privacidade não há como usar o serviço: o caminho é excluir a conta.
      throw new BadRequestException(
        'Termos e política de privacidade não podem ser revogados isoladamente; para isso, exclua a conta.',
      );
    }

    const now = new Date();
    if (input.granted) {
      const version = versionFor(purpose);
      const existing = await this.prisma.consent.findFirst({
        where: { userId, purpose, version, revokedAt: null },
      });
      if (!existing) {
        // Versões antigas da mesma finalidade deixam de valer.
        await this.prisma.consent.updateMany({
          where: { userId, purpose, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.prisma.consent.create({
          data: {
            userId,
            purpose,
            version,
            ip: context.ip ?? null,
            userAgent: context.userAgent?.slice(0, 300) ?? null,
          },
        });
      }
    } else {
      await this.prisma.consent.updateMany({
        where: { userId, purpose, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    await this.audit.record({
      actorId: userId,
      actorEmail: user.email ?? null,
      ip: context.ip ?? null,
      action: input.granted
        ? 'privacy.consent_granted'
        : 'privacy.consent_revoked',
      resourceType: 'Consent',
      resourceId: userId,
      changes: { purpose, version: versionFor(purpose) },
    });
    return this.status(user);
  }

  /** O titular tem consentimento ativo para a finalidade? (efeito imediato da revogação) */
  async hasConsent(userId: string, purpose: ConsentPurpose): Promise<boolean> {
    const found = await this.prisma.consent.findFirst({
      where: { userId, purpose, revokedAt: null },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** Vista de conformidade de um titular (admin da plataforma). */
  async subjectSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true, tenantId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const [consents, exports] = await Promise.all([
      this.prisma.consent.findMany({
        where: { userId },
        orderBy: { grantedAt: 'desc' },
        select: {
          purpose: true,
          version: true,
          grantedAt: true,
          revokedAt: true,
          ip: true,
        },
      }),
      this.prisma.dataExport.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          scope: true,
          status: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    ]);
    return { user, versions: documentVersions(), consents, exports };
  }
}
