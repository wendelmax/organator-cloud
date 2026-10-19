import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateIncidentDto } from './incident.dto';

// Espelha o ValidationPipe global (whitelist + forbidNonWhitelisted), no
// padrão de create-service.dto.spec.ts (#110).
const errorsFor = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(UpdateIncidentDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
};

describe('UpdateIncidentDto (#110)', () => {
  it('accepts a partial patch and an empty body (undefined fields pass)', async () => {
    await expect(errorsFor({})).resolves.toEqual([]);
    await expect(errorsFor({ title: 'Novo título' })).resolves.toEqual([]);
    await expect(errorsFor({ status: 'monitoring' })).resolves.toEqual([]);
  });

  it('rejects explicit null on non-nullable fields (title/severity/status/component/public)', async () => {
    await expect(errorsFor({ title: null })).resolves.toEqual(['title']);
    await expect(errorsFor({ severity: null })).resolves.toEqual(['severity']);
    await expect(errorsFor({ status: null })).resolves.toEqual(['status']);
    await expect(errorsFor({ component: null })).resolves.toEqual([
      'component',
    ]);
    await expect(errorsFor({ public: null })).resolves.toEqual(['public']);
  });

  it('keeps accepting null on the nullable fields (assigneeEmail/postmortemUrl)', async () => {
    await expect(
      errorsFor({ assigneeEmail: null, postmortemUrl: null }),
    ).resolves.toEqual([]);
  });

  it('rejects create-only fields: source and alertKey (índice único → P2002/500)', async () => {
    await expect(errorsFor({ source: 'alert:5xx' })).resolves.toEqual([
      'source',
    ]);
    await expect(errorsFor({ alertKey: 'alert-1' })).resolves.toEqual([
      'alertKey',
    ]);
  });
});
