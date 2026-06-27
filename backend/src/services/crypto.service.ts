import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = scryptSync(process.env.ENCRYPTION_KEY ?? 'dev-secret-change-me', 'salt', 32);

/**
 * Encrypts plaintext with AES-256-GCM.
 *
 * Stored format (base64): [ IV (12 bytes) | GCM auth tag (16 bytes) | ciphertext ]
 *
 * The IV is always prepended so that key rotation and re-encryption are possible
 * without storing the IV separately. Both encrypt() and decrypt() must agree on
 * this layout — do not change the byte offsets without a migration.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv (0..12) | tag (12..28) | ciphertext (28..)
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a value produced by encrypt().
 * Expects base64 input with the layout: IV (12 bytes) | GCM auth tag (16 bytes) | ciphertext.
 */
export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
