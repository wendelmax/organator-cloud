import { encryptSecret, decryptSecret } from './crypto.util';

describe('crypto.util (AES-256-GCM)', () => {
  const secretText = 'my-super-secret-api-key-12345';

  it('should encrypt secret text into iv:authTag:encrypted format', () => {
    const encrypted = encryptSecret(secretText);
    expect(encrypted).not.toEqual(secretText);
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(24); // 12 bytes IV hex
    expect(parts[1].length).toBe(32); // 16 bytes AuthTag hex
    expect(parts[2].length).toBeGreaterThan(0); // Encrypted payload hex
  });

  it('should decrypt encrypted text back to original plain text', () => {
    const encrypted = encryptSecret(secretText);
    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(secretText);
  });

  it('should return unencrypted text as-is if format is not iv:authTag:encrypted', () => {
    const plainText = 'unencrypted-legacy-key';
    const result = decryptSecret(plainText);
    expect(result).toBe(plainText);
  });

  it('should handle empty or null string gracefully', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });
});
