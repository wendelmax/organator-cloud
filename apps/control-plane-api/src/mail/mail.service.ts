import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailOptions {
  /**
   * E-mails não transacionais (ex.: marketing) só saem com consentimento ativo
   * do titular para a finalidade; a revogação vale no próximo envio.
   */
  requiresConsent?: { userId: string; purpose: 'marketing' | 'analytics' };
}

/**
 * Envio de e-mails transacionais via SMTP (`SMTP_URL`, ex.:
 * smtps://user:pass@smtp.example.com:465). Sem SMTP configurado, fora de
 * produção a mensagem vai para o log (desenvolvimento); em produção só é
 * registrado que o envio foi descartado — o conteúdo pode conter tokens.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(@Optional() private readonly prisma?: PrismaService) {
    const url = process.env.SMTP_URL?.trim();
    this.transport = url ? createTransport(url) : null;
    this.from =
      process.env.MAIL_FROM?.trim() || 'Organator <no-reply@localhost>';
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(
    message: MailMessage,
    options: MailOptions = {},
  ): Promise<boolean> {
    if (options.requiresConsent) {
      const { userId, purpose } = options.requiresConsent;
      const consent = await this.prisma?.consent.findFirst({
        where: { userId, purpose, revokedAt: null },
        select: { id: true },
      });
      if (!consent) {
        this.logger.log(`Skipped "${message.subject}": no ${purpose} consent`);
        return false;
      }
    }
    if (!this.transport) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(
          `SMTP_URL is not configured; dropped "${message.subject}" to ${message.to}`,
        );
      } else {
        this.logger.log(
          `[mail disabled] To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
        );
      }
      return false;
    }
    await this.transport.sendMail({ from: this.from, ...message });
    return true;
  }
}
