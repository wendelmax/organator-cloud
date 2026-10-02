import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
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

  constructor() {
    const url = process.env.SMTP_URL?.trim();
    this.transport = url ? createTransport(url) : null;
    this.from =
      process.env.MAIL_FROM?.trim() || 'Organator <no-reply@localhost>';
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async send(message: MailMessage): Promise<void> {
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
      return;
    }
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
