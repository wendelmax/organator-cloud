import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const ERASED = '[apagado]';

export const subjectHashOf = (email: string) =>
  crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/**
 * Direito ao esquecimento (LGPD art. 18, #108): apaga o titular de todas as
 * fontes da plataforma e anonimiza o que precisa ficar.
 *
 * - Apagado: usuário (em cascata: sessões, memberships, MFA, tokens de senha,
 *   histórico de senhas, exportações) e convites para o e-mail.
 * - Anonimizado: trilha de auditoria (ator, e-mail, IP e o e-mail dentro das
 *   alterações) e payloads de webhooks do Stripe guardados aqui.
 * - Exceção legal: notas e cobranças ficam no Stripe (obrigação contábil); a
 *   plataforma não as apaga, só remove a cópia local do e-mail.
 * - Prova: ErasureRecord sem dado pessoal (hash do e-mail, quem, quando, quanto).
 */
@Injectable()
export class ErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Pedido do próprio titular: confirma a identidade antes de apagar. */
  async eraseSelf(
    user: { userId?: string; apiKeyAuth?: boolean },
    confirmation: { password?: string; email?: string },
  ) {
    if (!user?.userId || user.apiKeyAuth) {
      throw new ForbiddenException('Available to signed-in users only');
    }
    const subject = await this.prisma.user.findUnique({
      where: { id: user.userId },
    });
    if (!subject) throw new NotFoundException('User not found');
    if (subject.authProvider === 'credentials') {
      const ok = await bcrypt
        .compare(confirmation.password ?? '', subject.password)
        .catch(() => false);
      if (!ok) throw new UnauthorizedException('Senha incorreta');
    } else if (
      (confirmation.email ?? '').trim().toLowerCase() !==
      subject.email.toLowerCase()
    ) {
      // Contas SSO não têm senha local: confirma digitando o próprio e-mail.
      throw new BadRequestException('Confirme digitando o seu e-mail');
    }
    return this.erase(subject.id, null);
  }

  /** Pedido tratado pelo admin da plataforma (ex.: titular sem acesso). */
  eraseByAdmin(userId: string, adminId: string) {
    return this.erase(userId, adminId);
  }

  private async erase(userId: string, requestedBy: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'PLATFORM_ADMIN') {
      throw new ForbiddenException(
        'Platform administrators must be removed by another administrator first',
      );
    }
    await this.assertNotLastOwner(user.id, user.tenantId, user.role);

    const email = user.email;
    const summary = await this.prisma.$transaction(async (tx) => {
      // Anonimiza antes de apagar: a trilha continua íntegra, sem a pessoa.
      const auditActor = await tx.auditLog.updateMany({
        where: { OR: [{ actorId: userId }, { actorEmail: email }] },
        data: { actorId: null, actorEmail: ERASED, ip: null },
      });
      const auditMentions = await tx.$executeRaw`
        UPDATE "audit_logs"
        SET "changes" = replace("changes"::text, ${email}, ${ERASED})::jsonb
        WHERE "changes"::text LIKE ${'%' + email + '%'}`;
      const webhookPayloads = await tx.$executeRaw`
        UPDATE "webhook_events"
        SET "payload" = replace("payload"::text, ${email}, ${ERASED})::jsonb
        WHERE "payload"::text LIKE ${'%' + email + '%'}`;
      const invitations = await tx.tenantInvitation.deleteMany({
        where: { email },
      });
      const apiKeys = await tx.apiKey.updateMany({
        where: { createdBy: userId },
        data: { createdBy: null },
      });
      await tx.user.delete({ where: { id: userId } });
      return {
        account: 'deleted',
        auditEntriesAnonymized: auditActor.count + Number(auditMentions),
        webhookPayloadsAnonymized: Number(webhookPayloads),
        invitationsDeleted: invitations.count,
        apiKeysDetached: apiKeys.count,
        legalException:
          'billing records kept by Stripe (accounting obligation)',
      };
    });

    const record = await this.prisma.erasureRecord.create({
      data: {
        subjectHash: subjectHashOf(email),
        requestedBy,
        reason: requestedBy ? 'admin_request' : 'subject_request',
        summary,
      },
    });
    await this.audit.record({
      actorId: requestedBy,
      action: 'compliance.subject_erased',
      resourceType: 'ErasureRecord',
      resourceId: record.id,
      changes: summary,
    });
    return { erased: true, erasureId: record.id, summary };
  }

  /** O último OWNER não some sem deixar o tenant órfão. */
  private async assertNotLastOwner(
    userId: string,
    homeTenantId: string,
    homeRole: string,
  ) {
    const ownedTenants = [
      ...(homeRole === 'OWNER' ? [homeTenantId] : []),
      ...(
        await this.prisma.tenantMembership.findMany({
          where: { userId, role: 'OWNER', status: 'active' },
          select: { tenantId: true },
        })
      ).map((m) => m.tenantId),
    ];
    for (const tenantId of new Set(ownedTenants)) {
      const otherOwners = await this.prisma.user.count({
        where: {
          id: { not: userId },
          OR: [
            { tenantId, role: 'OWNER' },
            {
              memberships: {
                some: { tenantId, role: 'OWNER', status: 'active' },
              },
            },
          ],
        },
      });
      if (otherOwners === 0) {
        throw new ConflictException(
          'Você é o único OWNER de uma organização: transfira a propriedade ou encerre a organização antes de apagar a conta.',
        );
      }
    }
  }
}
