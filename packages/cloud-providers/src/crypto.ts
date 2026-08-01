import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY || DEFAULT_KEY_HEX;
  if (envKey.length === 64) {
    return Buffer.from(envKey, 'hex');
  }
  return Buffer.from(envKey.padEnd(32, '0').slice(0, 32), 'utf8');
}

/**
 * Encrypts plain text using AES-256-GCM.
 * Returns formatted hex string: "iv:authTag:encrypted"
 */
export function encryptSecret(text: string): string {
  if (!text) return text;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts hex string formatted "iv:authTag:encrypted" using AES-256-GCM.
 * Returns decrypted plain text.
 */
export function decryptSecret(encryptedText: string): string {
  if (!encryptedText) return encryptedText;

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  if (ivHex.length !== 24 || authTagHex.length !== 32) {
    return encryptedText;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error(`Failed to decrypt secret: ${(err as Error).message}`);
  }
}
