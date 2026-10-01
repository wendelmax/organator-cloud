import type { IncomingMessage } from 'node:http';
import {
  createAppLogger,
  fastifyLoggingOptions,
  nestLogLevels,
  readLoggingConfig,
  resolveRequestId,
} from './logging.config';

describe('logging config', () => {
  it('defaults to JSON in production and pretty text elsewhere', () => {
    expect(readLoggingConfig({ NODE_ENV: 'production' })).toEqual({
      format: 'json',
      level: 'info',
    });
    expect(readLoggingConfig({})).toEqual({ format: 'pretty', level: 'info' });
    expect(
      readLoggingConfig({
        NODE_ENV: 'production',
        LOG_FORMAT: 'pretty',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      format: 'pretty',
      level: 'debug',
    });
  });

  it('rejects unknown formats and levels', () => {
    expect(() => readLoggingConfig({ LOG_FORMAT: 'xml' })).toThrow(
      'LOG_FORMAT',
    );
    expect(() => readLoggingConfig({ LOG_LEVEL: 'loud' })).toThrow('LOG_LEVEL');
  });

  it('maps LOG_LEVEL to cumulative Nest log levels', () => {
    expect(nestLogLevels('error')).toEqual(['fatal', 'error']);
    expect(nestLogLevels('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(nestLogLevels('trace')).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('enables Fastify access logs only in JSON mode', () => {
    expect(
      fastifyLoggingOptions({ format: 'json', level: 'warn' }).logger,
    ).toEqual({ level: 'warn' });
    expect(
      fastifyLoggingOptions({ format: 'pretty', level: 'info' }).logger,
    ).toBe(false);
  });

  it('builds a JSON console logger', () => {
    const logger = createAppLogger({ format: 'json', level: 'info' });
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    logger.log('hello', 'Test');
    const line = String(write.mock.calls[0][0]);
    write.mockRestore();
    expect(JSON.parse(line)).toMatchObject({
      level: 'log',
      message: 'hello',
      context: 'Test',
    });
  });

  describe('resolveRequestId', () => {
    const req = (id?: string) =>
      ({
        headers: id === undefined ? {} : { 'x-request-id': id },
      }) as IncomingMessage;

    it('keeps a safe client-provided id', () => {
      expect(resolveRequestId(req('abc-123_trace.1:2'))).toBe(
        'abc-123_trace.1:2',
      );
    });

    it.each(['', 'has space', 'a'.repeat(129), 'line\nbreak', '"><script>'])(
      'generates a UUID for unsafe id %j',
      (value) => {
        expect(resolveRequestId(req(value))).toMatch(/^[0-9a-f-]{36}$/);
      },
    );

    it('generates a UUID when absent', () => {
      expect(resolveRequestId(req())).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
