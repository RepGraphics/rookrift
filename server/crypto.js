import { createCipheriv, createDecipheriv, randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const hash = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(key).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [, saltHex, keyHex] = String(encoded || '').split('$');
  if (!saltHex || !keyHex || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(keyHex)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length));
  return timingSafeEqual(actual, expected);
}
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
