import { Logger } from '@nestjs/common';
import { AuditCleanupService } from './audit-cleanup.service';

describe('AuditCleanupService', () => {
  const originalEnv = process.env.NODE_ENV;
  let audit: any;
  let service: AuditCleanupService;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    audit = { cleanup: jest.fn().mockResolvedValue(0) };
    service = new AuditCleanupService(audit);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    delete process.env.AUDIT_RETENTION_DAYS;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.NODE_ENV = originalEnv;
    delete process.env.AUDIT_RETENTION_DAYS;
  });

  it('does not schedule anything under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    service.onModuleInit();
    jest.advanceTimersByTime(48 * 3600 * 1000);
    expect(audit.cleanup).not.toHaveBeenCalled();
  });

  it('runs at startup and then daily with the default 90 day retention', async () => {
    process.env.NODE_ENV = 'production';
    service.onModuleInit();
    expect(audit.cleanup).toHaveBeenCalledWith(90);

    jest.advanceTimersByTime(24 * 3600 * 1000);
    expect(audit.cleanup).toHaveBeenCalledTimes(2);
  });

  it('honors AUDIT_RETENTION_DAYS and logs removals', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUDIT_RETENTION_DAYS = '30';
    audit.cleanup.mockResolvedValue(12);
    service.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();

    expect(audit.cleanup).toHaveBeenCalledWith(30);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('12 registro(s)'));
  });

  it('swallows cleanup errors with a warning', async () => {
    process.env.NODE_ENV = 'production';
    audit.cleanup.mockRejectedValue(new Error('db locked'));
    service.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db locked'));
  });
});
