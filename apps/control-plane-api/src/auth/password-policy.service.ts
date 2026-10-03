import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loginLockoutPolicy } from './lockout-policy';

export interface PasswordPolicyRules {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** null = senhas não expiram. */
  expiresAfterDays: number | null;
  /** Quantas senhas anteriores não podem ser reutilizadas (0 = sem checagem). */
  historySize: number;
  /** null = padrão global (LOGIN_MAX_FAILED_ATTEMPTS / LOGIN_LOCKOUT_MINUTES). */
  maxFailedAttempts: number | null;
  lockoutMinutes: number | null;
}

/** Sem política cadastrada: o mínimo que a plataforma já exigia. */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicyRules = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSymbol: false,
  expiresAfterDays: null,
  historySize: 0,
  maxFailedAttempts: null,
  lockoutMinutes: null,
};

/** Faixas aceitas ao configurar (o mínimo de 8 caracteres não pode cair). */
const BOUNDS: Record<string, [number, number]> = {
  minLength: [8, 128],
  expiresAfterDays: [1, 3650],
  historySize: [0, 24],
  maxFailedAttempts: [3, 20],
  lockoutMinutes: [1, 1440],
};
const BOOLEAN_RULES = [
  'requireUppercase',
  'requireLowercase',
  'requireDigit',
  'requireSymbol',
] as const;

/** O que falta na senha segundo a política (vazio = aceita). */
export function policyViolations(
  password: string,
  policy: PasswordPolicyRules,
): string[] {
  const missing: string[] = [];
  if ((password ?? '').length < policy.minLength) {
    missing.push(`no mínimo ${policy.minLength} caracteres`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    missing.push('uma letra maiúscula');
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    missing.push('uma letra minúscula');
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    missing.push('um número');
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    missing.push('um símbolo');
  }
  return missing;
}

/**
 * Política de senha por tenant (#104): complexidade, expiração, histórico de
 * reuso e bloqueio por tentativas. Vale a política do tenant de origem do
 * usuário (o mesmo do login com senha).
 */
@Injectable()
export class PasswordPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPolicy(
    tenantId: string | null | undefined,
  ): Promise<PasswordPolicyRules> {
    if (!tenantId) return { ...DEFAULT_PASSWORD_POLICY };
    const stored = await this.prisma.passwordPolicy.findUnique({
      where: { tenantId },
    });
    if (!stored) return { ...DEFAULT_PASSWORD_POLICY };
    const rules = { ...DEFAULT_PASSWORD_POLICY };
    for (const key of Object.keys(
      DEFAULT_PASSWORD_POLICY,
    ) as (keyof PasswordPolicyRules)[]) {
      (rules as any)[key] = (stored as any)[key];
    }
    return rules;
  }

  async updatePolicy(
    tenantId: string,
    input: Partial<PasswordPolicyRules>,
    actorId?: string | null,
  ): Promise<PasswordPolicyRules> {
    const current = await this.getPolicy(tenantId);
    const next: PasswordPolicyRules = { ...current };
    for (const key of BOOLEAN_RULES) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'boolean') {
          throw new BadRequestException(`${key} must be a boolean`);
        }
        next[key] = input[key];
      }
    }
    for (const [key, [min, max]] of Object.entries(BOUNDS)) {
      const value = (input as any)[key];
      if (value === undefined) continue;
      const nullable = key !== 'minLength' && key !== 'historySize';
      if (value === null && nullable) {
        (next as any)[key] = null;
        continue;
      }
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new BadRequestException(
          `${key} must be an integer between ${min} and ${max}`,
        );
      }
      (next as any)[key] = value;
    }

    await this.prisma.passwordPolicy.upsert({
      where: { tenantId },
      create: { tenantId, ...next, updatedBy: actorId ?? null },
      update: { ...next, updatedBy: actorId ?? null },
    });
    await this.audit.record({
      actorId: actorId ?? null,
      action: 'tenant.password_policy_updated',
      resourceType: 'PasswordPolicy',
      resourceId: tenantId,
      changes: { from: current, to: next },
    });
    return next;
  }

  /**
   * Rejeita (400) a senha fora da política ou igual a uma das últimas
   * `historySize` (incluindo a atual) quando o usuário já existe.
   */
  async assertAcceptable(
    password: string,
    ctx: { tenantId: string | null | undefined; userId?: string },
  ): Promise<void> {
    const policy = await this.getPolicy(ctx.tenantId);
    const missing = policyViolations(password, policy);
    if (missing.length) {
      throw new BadRequestException(`A senha deve ter ${missing.join(', ')}.`);
    }
    if (!ctx.userId || policy.historySize === 0) return;

    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { password: true },
    });
    const previous = await this.prisma.passwordHistory.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: 'desc' },
      take: Math.max(policy.historySize - 1, 0),
      select: { hash: true },
    });
    const hashes = [user?.password, ...previous.map((p) => p.hash)].filter(
      (h): h is string => Boolean(h),
    );
    for (const hash of hashes) {
      if (await bcrypt.compare(password, hash).catch(() => false)) {
        throw new BadRequestException(
          `A nova senha não pode repetir nenhuma das últimas ${policy.historySize} senhas.`,
        );
      }
    }
  }

  /** Guarda o hash que está sendo substituído (máx. 24 por usuário). */
  async rememberPreviousHash(
    userId: string,
    previousHash: string | null | undefined,
  ) {
    if (!previousHash) return;
    await this.prisma.passwordHistory.create({
      data: { userId, hash: previousHash },
    });
    const stale = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: BOUNDS.historySize[1],
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.passwordHistory.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  isExpired(
    user: { passwordChangedAt: Date | null },
    policy: PasswordPolicyRules,
    now = new Date(),
  ): boolean {
    if (!policy.expiresAfterDays || !user.passwordChangedAt) return false;
    const ageMs = now.getTime() - user.passwordChangedAt.getTime();
    return ageMs > policy.expiresAfterDays * 24 * 60 * 60 * 1000;
  }

  /** Bloqueio por tentativas: o do tenant, ou o padrão global. */
  async lockoutFor(tenantId: string | null | undefined) {
    const global = loginLockoutPolicy();
    const policy = await this.getPolicy(tenantId);
    return {
      maxAttempts: policy.maxFailedAttempts ?? global.maxAttempts,
      lockoutMinutes: policy.lockoutMinutes ?? global.lockoutMinutes,
    };
  }
}
