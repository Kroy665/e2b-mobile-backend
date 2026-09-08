import { Sandbox } from 'e2b';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import { resolveSafePath } from '../../lib/safePath';
import { getSandbox, markSandboxReady } from './sandboxes.service';

const SANDBOX_REPO_PATH = '/home/user/app';
const MAX_READABLE_FILE_SIZE = 1_000_000;

async function connectToSandbox(userId: string, sandboxRowId: string): Promise<Sandbox> {
  const row = await getSandbox(userId, sandboxRowId);

  if ((row.status !== 'ready' && row.status !== 'paused') || !row.e2b_sandbox_id) {
    throw ApiError.badRequest('Sandbox is not ready');
  }

  try {
    const sandbox = await Sandbox.connect(row.e2b_sandbox_id, { apiKey: env.E2B_API_KEY });
    if (row.status === 'paused') {
      await markSandboxReady(row.id);
    }
    return sandbox;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to connect to sandbox', message);
  }
}

function safeRepoPath(userPath: string): string {
  try {
    return resolveSafePath(SANDBOX_REPO_PATH, userPath);
  } catch {
    throw ApiError.badRequest('Path must stay within the repository directory');
  }
}

export async function listFiles(userId: string, sandboxRowId: string, dirPath: string) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);
  const target = safeRepoPath(dirPath);

  try {
    const entries = await sandbox.files.list(target);
    return entries
      .filter((e) => e.name !== '.git')
      .map((e) => ({
        name: e.name,
        path: e.path.slice(SANDBOX_REPO_PATH.length) || '/',
        type: e.type,
        size: e.size,
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.notFound('Directory not found', message);
  }
}

export async function readFile(userId: string, sandboxRowId: string, filePath: string) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);
  const target = safeRepoPath(filePath);

  try {
    const info = await sandbox.files.getInfo(target);
    if (info.type !== 'file') {
      throw ApiError.badRequest('Path is not a file');
    }
    if (info.size > MAX_READABLE_FILE_SIZE) {
      throw ApiError.badRequest('File is too large to read via this endpoint');
    }

    const content = await sandbox.files.read(target);
    return { path: filePath, content, size: info.size };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.notFound('File not found', message);
  }
}

export async function writeFile(userId: string, sandboxRowId: string, filePath: string, content: string) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);
  const target = safeRepoPath(filePath);

  try {
    await sandbox.files.write(target, content);
    return { path: filePath, size: Buffer.byteLength(content, 'utf8') };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to write file', message);
  }
}

export async function deleteFile(userId: string, sandboxRowId: string, filePath: string) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);
  const target = safeRepoPath(filePath);

  // sandbox.files.remove() does not throw for a path that doesn't exist
  // (it behaves like `rm -f`), so existence must be checked explicitly to
  // return a correct 404 instead of a false-positive 200.
  const exists = await sandbox.files.exists(target).catch(() => false);
  if (!exists) {
    throw ApiError.notFound('File not found');
  }

  try {
    await sandbox.files.remove(target);
    return { path: filePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to delete file', message);
  }
}
