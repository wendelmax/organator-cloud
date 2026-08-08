import { MfaService } from './mfa.service';

describe('MfaService', () => {
  it('enrolls and enables a TOTP credential with the current otplib API', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@organator.example',
      mfaEnabled: false,
      mfaSecretEncrypted: null as string | null,
    };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => user),
        update: jest.fn(async ({ data }: { data: Partial<typeof user> }) => {
          Object.assign(user, data);
          return user;
        }),
      },
    };
    const service = new MfaService(prisma as never);

    const enrollment = await service.enroll(user.id);
    expect(enrollment).toHaveProperty('secret');
    expect(enrollment).toHaveProperty(
      'otpauthUrl',
      expect.stringContaining('otpauth://totp/'),
    );
    if (!('secret' in enrollment)) throw new Error('Expected a new enrollment');

    const { generate } = await import('otplib');
    const code = await generate({ secret: enrollment.secret });

    await expect(service.enable(user.id, code)).resolves.toEqual({
      enabled: true,
    });
    expect(user.mfaEnabled).toBe(true);
    expect(user.mfaSecretEncrypted).not.toBe(enrollment.secret);
  });
});
