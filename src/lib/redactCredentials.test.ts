import { describe, expect, it } from 'vitest';
import { redactCredentials } from './redactCredentials';

describe('redactCredentials', () => {
  it('strips a token embedded in an https URL', () => {
    const input = "branch 'main' set up to track 'https://x-access-token:gho_SECRET123@github.com/foo/bar'.";
    const output = redactCredentials(input);
    expect(output).not.toContain('gho_SECRET123');
    expect(output).toContain('https://github.com/foo/bar');
  });

  it('strips credentials from multiple URLs in the same text', () => {
    const input = 'https://a:secret1@github.com/x and https://b:secret2@github.com/y';
    const output = redactCredentials(input);
    expect(output).not.toContain('secret1');
    expect(output).not.toContain('secret2');
  });

  it('leaves a plain https URL without credentials unchanged', () => {
    const input = 'To https://github.com/foo/bar.git';
    expect(redactCredentials(input)).toBe(input);
  });

  it('leaves non-URL text unchanged', () => {
    const input = '1 file changed, 2 insertions(+)';
    expect(redactCredentials(input)).toBe(input);
  });
});
