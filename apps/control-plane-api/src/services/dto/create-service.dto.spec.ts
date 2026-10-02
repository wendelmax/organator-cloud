import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateServiceDto } from './create-service.dto';

const errorsFor = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(CreateServiceDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
};

describe('CreateServiceDto', () => {
  it('accepts what the panel sends for a VPS service', async () => {
    await expect(
      errorsFor({
        name: 'api',
        cloudProvider: 'VPS',
        repositoryUrl: 'github.com/acme/api',
        image: 'ghcr.io/acme/api:1.2.0',
        vpsHost: 'deploy@10.0.0.5',
      }),
    ).resolves.toEqual([]);
  });

  it('keeps accepting the legacy DOCKER_VPS value and other providers', async () => {
    await expect(
      errorsFor({ name: 'a', cloudProvider: 'DOCKER_VPS', image: 'nginx' }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor({ name: 'a', cloudProvider: 'VERCEL' }),
    ).resolves.toEqual([]);
  });

  it('rejects unknown providers and malformed image or host', async () => {
    await expect(
      errorsFor({ name: 'a', cloudProvider: 'GCP' }),
    ).resolves.toEqual(['cloudProvider']);
    await expect(
      errorsFor({ name: 'a', cloudProvider: 'VPS', image: 'img; rm -rf /' }),
    ).resolves.toEqual(['image']);
    await expect(
      errorsFor({ name: 'a', cloudProvider: 'VPS', vpsHost: '10.0.0.5' }),
    ).resolves.toEqual(['vpsHost']);
  });
});
