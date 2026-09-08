import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

describe('crypto encrypt/decrypt', () => {
  it('round-trips a plaintext string', () => {
    const plaintext = 'gho_super_secret_github_token_1234567890';
    const ciphertext = encrypt(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-value';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('a token value');
    const parts = ciphertext.split(':');
    const tampered = [parts[0], parts[1], Buffer.from('tampered').toString('base64')].join(':');
    expect(() => decrypt(tampered)).toThrow();
  });
});
