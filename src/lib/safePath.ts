import path from 'path';

/**
 * Resolves a user-supplied relative path against a fixed base directory,
 * refusing to return anything outside that base (blocks `../` traversal,
 * absolute-path overrides, symlink-looking tricks at the string level).
 * Throws if the resolved path would escape the base.
 */
export function resolveSafePath(basePath: string, userPath: string): string {
  const resolvedBase = path.resolve(basePath);
  const resolved = path.resolve(resolvedBase, userPath);

  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path resolves outside the allowed directory');
  }

  return resolved;
}
