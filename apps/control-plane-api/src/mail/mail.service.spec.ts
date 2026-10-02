const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));
jest.mock('nodemailer', () => ({ createTransport }));

import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

describe('MailService', () => {
  const originalEnv = { ...process.env };
  const message = {
    to: 'owner@acme.com',
    subject: 'Reset',
    text: 'secret link',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('sends through the SMTP_URL transport with MAIL_FROM', async () => {
    process.env.SMTP_URL = 'smtps://u:p@smtp.example.com:465';
    process.env.MAIL_FROM = 'Acme <no-reply@acme.com>';
    const mail = new MailService();

    await mail.send(message);

    expect(mail.enabled).toBe(true);
    expect(createTransport).toHaveBeenCalledWith(
      'smtps://u:p@smtp.example.com:465',
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Acme <no-reply@acme.com>',
      ...message,
    });
  });

  it('logs the message in development when SMTP is not configured', async () => {
    process.env.NODE_ENV = 'development';
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const mail = new MailService();

    await mail.send(message);

    expect(mail.enabled).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain('secret link');
  });

  it('never logs the content in production', async () => {
    process.env.NODE_ENV = 'production';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await new MailService().send(message);

    expect(log).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('owner@acme.com');
    expect(warn.mock.calls[0][0]).not.toContain('secret link');
  });
});
