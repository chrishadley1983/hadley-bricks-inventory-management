import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt, encryptObject, decryptObject } from '../encryption';

describe('Encryption Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-for-testing-32chars!';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('encrypt', () => {
    it('should encrypt a plaintext string', async () => {
      const plaintext = 'Hello, World!';

      const encrypted = await encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(plaintext);
      // Should be base64 encoded
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
    });

    it('should produce different ciphertext for same plaintext (random IV)', async () => {
      const plaintext = 'Same message';

      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should encrypt empty string', async () => {
      const plaintext = '';

      const encrypted = await encrypt(plaintext);

      expect(encrypted).toBeDefined();
      expect(encrypted.length).toBeGreaterThan(0);
    });

    it('should encrypt unicode characters', async () => {
      const plaintext = '你好世界 🌍 Привет мир';

      const encrypted = await encrypt(plaintext);

      expect(encrypted).toBeDefined();
      // Verify it can be decrypted
      const decrypted = await decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt long strings', async () => {
      const plaintext = 'A'.repeat(10000);

      const encrypted = await encrypt(plaintext);

      expect(encrypted).toBeDefined();
      const decrypted = await decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw error when encryption key is not set', async () => {
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;

      await expect(encrypt('test')).rejects.toThrow(
        'CREDENTIALS_ENCRYPTION_KEY environment variable is required'
      );
    });
  });

  describe('decrypt', () => {
    it('should decrypt an encrypted string', async () => {
      const plaintext = 'Secret message';
      const encrypted = await encrypt(plaintext);

      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should decrypt empty string that was encrypted', async () => {
      const plaintext = '';
      const encrypted = await encrypt(plaintext);

      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error for invalid base64 data', async () => {
      const invalidData = 'not-valid-base64!!!';

      await expect(decrypt(invalidData)).rejects.toThrow();
    });

    it('should throw error for tampered ciphertext', async () => {
      const encrypted = await encrypt('test');

      // Tamper with the ciphertext
      const buffer = Buffer.from(encrypted, 'base64');
      buffer[buffer.length - 1] = buffer[buffer.length - 1] ^ 0xff;
      const tampered = buffer.toString('base64');

      await expect(decrypt(tampered)).rejects.toThrow();
    });

    it('should throw error for truncated ciphertext', async () => {
      const encrypted = await encrypt('test');
      const truncated = encrypted.substring(0, 20);

      await expect(decrypt(truncated)).rejects.toThrow();
    });

    it('should handle PostgreSQL bytea hex-escaped format', async () => {
      const plaintext = 'Test with hex format';
      const encrypted = await encrypt(plaintext);

      // Simulate PostgreSQL bytea hex format: \x followed by hex
      const hexEncoded = '\\x' + Buffer.from(encrypted, 'utf8').toString('hex');

      const decrypted = await decrypt(hexEncoded);

      expect(decrypted).toBe(plaintext);
    });

    it('should throw error when encryption key is not set', async () => {
      const encrypted = await encrypt('test'); // Create valid encrypted data first
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;

      await expect(decrypt(encrypted)).rejects.toThrow(
        'CREDENTIALS_ENCRYPTION_KEY environment variable is required'
      );
    });

    it('should throw error when decrypting with wrong key', async () => {
      const encrypted = await encrypt('test');

      // Change encryption key
      process.env.CREDENTIALS_ENCRYPTION_KEY = 'different-encryption-key-32chars!!';

      await expect(decrypt(encrypted)).rejects.toThrow();
    });
  });

  describe('encryptObject', () => {
    it('should encrypt an object', async () => {
      const obj = { username: 'john', password: 'secret123' };

      const encrypted = await encryptObject(obj);

      expect(encrypted).toBeDefined();
      expect(typeof encrypted).toBe('string');
      // Should not contain plaintext
      expect(encrypted).not.toContain('john');
      expect(encrypted).not.toContain('secret123');
    });

    it('should encrypt complex nested objects', async () => {
      const obj = {
        user: {
          name: 'John',
          credentials: {
            apiKey: 'abc123',
            tokens: ['token1', 'token2'],
          },
        },
        settings: {
          enabled: true,
          count: 42,
        },
      };

      const encrypted = await encryptObject(obj);
      const decrypted = await decryptObject<typeof obj>(encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('should encrypt arrays', async () => {
      const arr = ['item1', 'item2', 'item3'];

      const encrypted = await encryptObject(arr);
      const decrypted = await decryptObject<string[]>(encrypted);

      expect(decrypted).toEqual(arr);
    });

    it('should handle objects with special characters', async () => {
      const obj = {
        message: 'Hello, "World"! \n\t Special chars: 日本語',
        path: 'C:\\Users\\Test',
      };

      const encrypted = await encryptObject(obj);
      const decrypted = await decryptObject<typeof obj>(encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('should handle empty object', async () => {
      const obj = {};

      const encrypted = await encryptObject(obj);
      const decrypted = await decryptObject<object>(encrypted);

      expect(decrypted).toEqual({});
    });

    it('should handle object with null values', async () => {
      const obj = { name: 'test', value: null };

      const encrypted = await encryptObject(obj);
      const decrypted = await decryptObject<typeof obj>(encrypted);

      expect(decrypted).toEqual(obj);
    });
  });

  describe('decryptObject', () => {
    it('should decrypt an encrypted object', async () => {
      const obj = { key: 'value', number: 123, bool: true };
      const encrypted = await encryptObject(obj);

      const decrypted = await decryptObject<typeof obj>(encrypted);

      expect(decrypted).toEqual(obj);
    });

    it('should throw error for invalid JSON after decryption', async () => {
      // Encrypt a non-JSON string
      const encrypted = await encrypt('not valid json {');

      await expect(decryptObject(encrypted)).rejects.toThrow();
    });

    it('should preserve type information', async () => {
      interface Credentials {
        apiKey: string;
        secret: string;
        expiresAt: number;
      }

      const creds: Credentials = {
        apiKey: 'abc123',
        secret: 'xyz789',
        expiresAt: 1704067200,
      };

      const encrypted = await encryptObject(creds);
      const decrypted = await decryptObject<Credentials>(encrypted);

      expect(decrypted.apiKey).toBe('abc123');
      expect(decrypted.secret).toBe('xyz789');
      expect(decrypted.expiresAt).toBe(1704067200);
    });
  });

  describe('round-trip encryption', () => {
    it('should handle repeated encrypt/decrypt cycles', async () => {
      const original = 'Test message for round trip';
      let current = original;

      for (let i = 0; i < 5; i++) {
        const encrypted = await encrypt(current);
        current = await decrypt(encrypted);
        expect(current).toBe(original);
      }
    });

    it('should handle JSON with dates as strings', async () => {
      const obj = {
        createdAt: '2024-01-15T10:30:00Z',
        updatedAt: '2024-01-15T12:00:00Z',
      };

      const encrypted = await encryptObject(obj);
      const decrypted = await decryptObject<typeof obj>(encrypted);

      expect(decrypted.createdAt).toBe('2024-01-15T10:30:00Z');
      expect(decrypted.updatedAt).toBe('2024-01-15T12:00:00Z');
    });

    it('should handle large objects', async () => {
      const largeObj = {
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          value: Math.random(),
        })),
      };

      const encrypted = await encryptObject(largeObj);
      const decrypted = await decryptObject<typeof largeObj>(encrypted);

      expect(decrypted.data).toHaveLength(1000);
      expect(decrypted.data[0].id).toBe(0);
      expect(decrypted.data[999].id).toBe(999);
    });
  });

  describe('encryption key derivation', () => {
    it('should produce consistent encryption with same key', async () => {
      const plaintext = 'Test message';

      // Note: Different IV means different ciphertext, but same key means decryption works
      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);

      // Both should decrypt to same value
      const decrypted1 = await decrypt(encrypted1);
      const decrypted2 = await decrypt(encrypted2);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    it('should fail decryption with different key', async () => {
      const encrypted = await encrypt('secret');

      // Change the encryption key
      process.env.CREDENTIALS_ENCRYPTION_KEY = 'completely-different-key-32chars!';

      // Decryption should fail
      await expect(decrypt(encrypted)).rejects.toThrow();
    });
  });

  describe('security properties', () => {
    it('should use authenticated encryption (detects tampering)', async () => {
      const encrypted = await encrypt('test');
      const buffer = Buffer.from(encrypted, 'base64');

      // Modify a byte in the middle of the ciphertext
      const midPoint = Math.floor(buffer.length / 2);
      buffer[midPoint] = buffer[midPoint] ^ 0x01;

      const tampered = buffer.toString('base64');

      // Should detect tampering and throw
      await expect(decrypt(tampered)).rejects.toThrow();
    });

    it('should produce ciphertext larger than plaintext (includes IV, salt, auth tag)', async () => {
      const plaintext = 'Short';
      const encrypted = await encrypt(plaintext);

      const ciphertextBuffer = Buffer.from(encrypted, 'base64');
      const plaintextBuffer = Buffer.from(plaintext, 'utf8');

      // Ciphertext should be significantly larger due to:
      // - 16 bytes salt
      // - 16 bytes IV
      // - 16 bytes auth tag
      // - encrypted content (same size as plaintext for AES-GCM stream cipher)
      // Total overhead = 48 bytes
      expect(ciphertextBuffer.length).toBeGreaterThanOrEqual(plaintextBuffer.length + 48);
    });

    it('should use random salt for key derivation', async () => {
      // Encrypt same message twice
      const encrypted1 = await encrypt('same');
      const encrypted2 = await encrypt('same');

      // Extract salt (first 16 bytes)
      const buffer1 = Buffer.from(encrypted1, 'base64');
      const buffer2 = Buffer.from(encrypted2, 'base64');

      const salt1 = buffer1.subarray(0, 16);
      const salt2 = buffer2.subarray(0, 16);

      // Salts should be different
      expect(salt1.equals(salt2)).toBe(false);
    });
  });
});
