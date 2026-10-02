import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';

type Purpose = 'reset' | 'activation';

const TTL_MS: Record<Purpose, number> = {
  reset: 60 * 60 * 1000, // 1 hora
  activation: 72 * 60 * 60 * 1000, // 3 dias: o cliente pode demorar a abrir o e-mail
};
/** Intervalo mínimo entre e-mails para o mesmo usuário (anti-spam). */
const COOLDOWN_MS = 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

/**
 * Recuperação de senha e ativação de contas criadas sem senha conhecida (dono
 * criado no checkout ou pelo painel). O token só existe no link enviado por
 * e-mail; no banco fica o SHA-256, com expiração e uso único.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Sempre conclui sem revelar se o e-mail existe (evita enumeração de contas).
   * Contas SSO não têm senha local e são ignoradas.
   */
  async requestReset(email: string, ip?: string | null): Promise<void> {
    // Mesma regra do login: o e-mail é comparado exatamente como cadastrado.
    const normalized = (email || '').trim();
    if (!normalized) return;
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (!user || user.authProvider !== 'credentials') return;
    if (!(await this.issue(user.id, user.email, 'reset'))) return;
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      ip: ip ?? null,
      action: 'auth.password_reset_requested',
      resourceType: 'Auth',
      resourceId: user.id,
      changes: {},
    });
  }

  /**
   * Envia o link para definir a senha a um usuário recém-criado com senha
   * aleatória. Falhas de envio não interrompem quem chamou (criação do tenant).
   */
  async sendActivation(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.authProvider !== 'credentials') return;
      await this.issue(user.id, user.email, 'activation');
    } catch (err) {
      this.logger.warn(
        `Could not send the activation e-mail to user ${userId}: ${(err as Error).message}`,
      );
    }
  }

  async resetPassword(token: string, newPassword: string) {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `A nova senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`,
      );
    }
    const tokenHash = hashToken(token || '');
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    const invalid = new BadRequestException('Link inválido ou expirado');
    if (!record) throw invalid;

    const now = new Date();
    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      // Consome o token de forma atômica: duas submissões do mesmo link não
      // passam as duas.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw invalid;
      await tx.user.update({
        where: { id: record.userId },
        data: {
          password,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          loginLockedUntil: null,
        },
      });
      // Outros links pendentes deixam de valer e sessões abertas (possivelmente
      // de quem tinha a senha antiga) são encerradas.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    await this.audit.record({
      actorId: record.userId,
      action:
        record.purpose === 'activation'
          ? 'auth.account_activated'
          : 'auth.password_reset',
      resourceType: 'Auth',
      resourceId: record.userId,
      changes: {},
    });
    return { success: true };
  }

  /** Cria o token e envia o e-mail; false se ainda está no intervalo mínimo. */
  private async issue(
    userId: string,
    email: string,
    purpose: Purpose,
  ): Promise<boolean> {
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId,
        createdAt: { gt: new Date(Date.now() - COOLDOWN_MS) },
      },
    });
    if (recent) return false;

    const token = crypto.randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        purpose,
        expiresAt: new Date(Date.now() + TTL_MS[purpose]),
      },
    });

    const backoffice = (
      process.env.BACKOFFICE_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const link = `${backoffice}/reset-password?token=${token}`;
    await this.mail.send(
      purpose === 'activation'
        ? {
            to: email,
            subject: 'Ative sua conta no Organator',
            text: `Sua organização foi criada no Organator.\n\nDefina sua senha para entrar (o link vale por 3 dias):\n${link}\n`,
          }
        : {
            to: email,
            subject: 'Redefinição de senha do Organator',
            text: `Recebemos um pedido para redefinir a sua senha.\n\nUse o link abaixo (vale por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.\n`,
          },
    );
    return true;
  }
}
