import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export function createVault(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('ENCRYPTION_KEY must be 64 hex characters. See .env.example.');
  const key = Buffer.from(secret, 'hex');
  return {
    encrypt(value) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value) {
      const bytes = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
