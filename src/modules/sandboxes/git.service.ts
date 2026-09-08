import { CommandExitError, Sandbox } from 'e2b';
import { ApiError } from '../../lib/errors';
import { redactCredentials } from '../../lib/redactCredentials';
import { shellQuote } from '../../lib/shellQuote';
import { getDecryptedAccessToken } from '../github/github.service';
import { SANDBOX_REPO_PATH, connectToSandbox } from './sandboxes.service';
import { GitCommitInput, GitPushInput } from './git.schemas';

async function runGit(sandbox: Sandbox, args: string) {
  try {
    return await sandbox.commands.run(`git ${args}`, { cwd: SANDBOX_REPO_PATH, timeoutMs: 60_000 });
  } catch (err) {
    if (err instanceof CommandExitError) {
      throw ApiError.badRequest('Git command failed', redactCredentials(err.stderr || err.stdout));
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to run git command', message);
  }
}

export async function gitStatus(userId: string, sandboxRowId: string) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);

  const [statusResult, branchResult] = await Promise.all([
    runGit(sandbox, 'status --porcelain'),
    runGit(sandbox, 'rev-parse --abbrev-ref HEAD'),
  ]);

  const changedFiles = statusResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));

  return {
    branch: branchResult.stdout.trim(),
    changedFiles,
    clean: changedFiles.length === 0,
  };
}

/** Stages all changes and commits them. Configures a default git identity if none is set yet. */
export async function gitCommit(userId: string, sandboxRowId: string, input: GitCommitInput) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);

  await sandbox.commands
    .run('git config user.email || git config user.email "agent@e2b.local"', { cwd: SANDBOX_REPO_PATH })
    .catch(() => undefined);
  await sandbox.commands
    .run('git config user.name || git config user.name "AI Coding Agent"', { cwd: SANDBOX_REPO_PATH })
    .catch(() => undefined);

  await runGit(sandbox, 'add -A');

  const statusCheck = await runGit(sandbox, 'status --porcelain');
  if (!statusCheck.stdout.trim()) {
    throw ApiError.badRequest('Nothing to commit — no changes in the repository');
  }

  const result = await runGit(sandbox, `commit -m ${shellQuote(input.message)}`);
  const commitHash = await runGit(sandbox, 'rev-parse HEAD');

  return { commitHash: commitHash.stdout.trim(), output: redactCredentials(result.stdout) };
}

export async function gitPush(userId: string, sandboxRowId: string, input: GitPushInput) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);
  const accessToken = await getDecryptedAccessToken(userId);

  const branch = input.branch ?? (await runGit(sandbox, 'rev-parse --abbrev-ref HEAD')).stdout.trim();
  const setUpstreamFlag = input.setUpstream ? '-u ' : '';

  // Use a short-lived per-request remote URL carrying the token so the
  // token never touches `git remote -v` output or repo config permanently.
  const remoteUrl = (await runGit(sandbox, 'remote get-url origin')).stdout.trim();
  const authedUrl = remoteUrl.replace(
    /^https:\/\/(?:[^@]+@)?/,
    `https://x-access-token:${accessToken}@`
  );

  try {
    const result = await sandbox.commands.run(
      `git push ${setUpstreamFlag}${shellQuote(authedUrl)} ${shellQuote(`HEAD:${branch}`)}`,
      { cwd: SANDBOX_REPO_PATH, timeoutMs: 60_000 }
    );
    return { branch, output: redactCredentials(result.stdout) };
  } catch (err) {
    if (err instanceof CommandExitError) {
      throw ApiError.badRequest('Git push failed', redactCredentials(err.stderr || err.stdout));
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to push', message);
  }
}
