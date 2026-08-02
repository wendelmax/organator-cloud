import {
  maskSecret,
  maskProviderData,
  testProviderConnection,
  encryptSecret,
  decryptSecret,
} from '@organator/cloud-providers';

describe('providers (masking + testConnection)', () => {
  describe('maskSecret', () => {
    it('masks tokens sk_* as sk-****', () => {
      expect(maskSecret('sk_my-very-long-token-abc123')).toBe('sk-****');
    });

    it('masks private keys keeping only the header', () => {
      const key =
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
      expect(maskSecret(key)).toBe('-----BEGIN [PRIVATE KEY] ****');
    });

    it('masks other long secrets keeping only the 4-char prefix', () => {
      expect(maskSecret('AKIAIOSFODNN7EXAMPLE')).toBe('AKIA-****');
    });

    it('masks short values as **** and null as null', () => {
      expect(maskSecret('abc')).toBe('****');
      expect(maskSecret(null)).toBeNull();
      expect(maskSecret(undefined)).toBeNull();
    });
  });

  describe('maskProviderData', () => {
    it('masks every secret field without leaking plain values', () => {
      const encrypted = {
        accessKeyId: encryptSecret('AKIAIOSFODNN7EXAMPLE'),
        secretAccessKey: encryptSecret(
          'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        ),
      };
      const masked = maskProviderData(encrypted);
      expect(masked.accessKeyId).toBe('AKIA-****');
      expect(masked.secretAccessKey).toBe('****');
      expect(JSON.stringify(masked)).not.toContain('JalrXUtnFEMI');
    });

    it('maps apiToken to sk-**** and privateKey to a safe placeholder', () => {
      const masked = maskProviderData({
        apiToken: encryptSecret('sk_live_whatever'),
        privateKey: encryptSecret('-----BEGIN RSA PRIVATE KEY-----...'),
      });
      expect(masked.apiToken).toBe('sk-****');
      expect(masked.privateKey).toBe('-----BEGIN [PRIVATE KEY] ****');
    });
  });

  describe('testProviderConnection', () => {
    it('reports mock credentials as simulated success', async () => {
      const result = await testProviderConnection('VERCEL', {
        apiToken: encryptSecret('mock-token'),
      });
      expect(result.ok).toBe(true);
      expect(result.mock).toBe(true);
    });

    it('reports missing credentials as mock (never a real call)', async () => {
      const result = await testProviderConnection('AWS', {
        accessKeyId: '',
        secretAccessKey: '',
      });
      expect(result.ok).toBe(true);
      expect(result.mock).toBe(true);
    });

    it('fails gracefully (no throw) on real invalid Vercel credentials', async () => {
      const result = await testProviderConnection(
        'VERCEL',
        { apiToken: encryptSecret('sk_live_invalid-token-for-test') },
        {},
        3000,
      );
      expect(result.ok).toBe(false);
      expect(typeof result.message).toBe('string');
    });

    it('returns decrypted round-trip consistency', () => {
      const original = 'super-secret-value';
      expect(decryptSecret(encryptSecret(original))).toBe(original);
    });
  });
});
