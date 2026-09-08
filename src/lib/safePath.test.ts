import { describe, expect, it } from 'vitest';
import { resolveSafePath } from './safePath';

const BASE = '/home/user/app';

describe('resolveSafePath', () => {
  it('resolves a plain relative path under the base', () => {
    expect(resolveSafePath(BASE, 'src/index.ts')).toBe('/home/user/app/src/index.ts');
  });

  it('resolves "." to the base itself', () => {
    expect(resolveSafePath(BASE, '.')).toBe(BASE);
  });

  it('blocks a simple ../ traversal', () => {
    expect(() => resolveSafePath(BASE, '../etc/passwd')).toThrow();
  });

  it('blocks a deeply nested ../ traversal', () => {
    expect(() => resolveSafePath(BASE, 'src/../../../etc/passwd')).toThrow();
  });

  it('blocks an absolute path override attempt', () => {
    expect(() => resolveSafePath(BASE, '/etc/passwd')).toThrow();
  });

  it('blocks a path that merely shares a string prefix with the base', () => {
    // '/home/user/app-evil' starts with the string '/home/user/app' but is a
    // sibling directory, not a subdirectory — must not be allowed through.
    expect(() => resolveSafePath(BASE, '../app-evil/secret')).toThrow();
  });
});
