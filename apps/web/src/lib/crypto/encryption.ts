/**
 * Encryption utilities for securely storing platform credentials
 *
 * Uses AES-256-GCM for authenticated encryption with a server-side key.
 * The encryption key should be stored in CREDENTIALS_ENCRYPTION_KEY env var.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16;

/**
 * Get the encryption key from environment or derive from a passphrase
 */
async function getEncryptionKey(salt: Buffer): Promise<Buffer> {
  const keySource = process.env.CREDENTIALS_ENCRYPTION_KEY;

  if (!keySource) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY environment variable is required for credential encryption'
    );
  }

  // Derive a key from the passphrase using scrypt
  const key = (await scryptAsync(keySource, salt, KEY_LENGTH)) as Buffer;
  return key;
}

/**
 * Encrypt a string value
 * Returns a base64-encoded string containing: salt + iv + authTag + ciphertext
 */
export async function encrypt(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await getEncryptionKey(salt);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine salt + iv + authTag + ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);

  return combined.toString('base64');
}

/**
 * Decrypt a base64-encoded encrypted string
 * Handles PostgreSQL bytea hex-escaped format (\\x...) if present
 */
export async function decrypt(encryptedData: string): Promise<string> {
  // Handle PostgreSQL bytea hex-escaped format
  let base64Data = encryptedData;
  if (encryptedData.startsWith('\\x')) {
    // Convert hex to the original base64 string
    const hexStr = encryptedData.slice(2);
    base64Data = Buffer.from(hexStr, 'hex').toString('utf8');
  }

  const combined = Buffer.from(base64Data, 'base64');

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = await getEncryptionKey(salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt an object (serializes to JSON first)
 */
export async function encryptObject<T extends object>(data: T): Promise<string> {
  const json = JSON.stringify(data);
  return encrypt(json);
}

/**
 * Decrypt to an object (parses JSON)
 */
export async function decryptObject<T>(encryptedBase64: string): Promise<T> {
  const json = await decrypt(encryptedBase64);
  return JSON.parse(json) as T;
}
