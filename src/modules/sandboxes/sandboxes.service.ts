import { CommandExitError, Sandbox, SandboxNotFoundError } from 'e2b';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import { createE2bSandbox } from '../../lib/e2b';
import { parseOpencodeEvents, summarizeOpencodeEvents } from '../../lib/opencodeEvents';
import { shellQuote } from '../../lib/shellQuote';
import { supabaseAdmin } from '../../lib/supabase';
import { getProviderEnvVars } from '../ai-provider/ai-provider.service';
import { getDecryptedAccessToken } from '../github/github.service';
import { CreateSandboxInput, RunOpencodeInput } from './sandboxes.schemas';

export const SANDBOX_REPO_PATH = '/home/user/app';

interface SandboxRow {
  id: string;
  user_id: string;
  e2b_sandbox_id: string;
  repo_url: string;
  status: 'creating' | 'ready' | 'paused' | 'failed' | 'terminated';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

async function updateSandboxRow(id: string, patch: Partial<SandboxRow>) {
  await supabaseAdmin
    .from('sandboxes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/** Marks a sandbox row `ready` — call after successfully resuming a paused sandbox. */
export async function markSandboxReady(sandboxRowId: string) {
  await updateSandboxRow(sandboxRowId, { status: 'ready' });
}

/**
 * Creates an E2B sandbox and clones the given GitHub repo into it using the
 * user's stored GitHub access token. Returns immediately with a `creating`
 * row while the clone runs; the row is updated to `ready`/`failed` once done.
 */
export async function createSandboxWithRepo(userId: string, input: CreateSandboxInput) {
  const accessToken = await getDecryptedAccessToken(userId);

  const { data: row, error: insertError } = await supabaseAdmin
    .from('sandboxes')
    .insert({
      user_id: userId,
      e2b_sandbox_id: '',
      repo_url: input.repoUrl,
      status: 'creating',
    })
    .select()
    .single<SandboxRow>();

  if (insertError || !row) {
    throw ApiError.internal('Failed to record sandbox', insertError?.message);
  }

  try {
    const sandbox = await createE2bSandbox();
    await updateSandboxRow(row.id, { e2b_sandbox_id: sandbox.sandboxId });

    await sandbox.git.clone(input.repoUrl, {
      path: SANDBOX_REPO_PATH,
      branch: input.branch,
      username: 'x-access-token',
      password: accessToken,
      depth: 1,
    });

    await updateSandboxRow(row.id, { status: 'ready' });

    return {
      id: row.id,
      sandboxId: sandbox.sandboxId,
      repoUrl: input.repoUrl,
      status: 'ready' as const,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error creating sandbox';
    await updateSandboxRow(row.id, { status: 'failed', error_message: message });
    throw ApiError.internal('Failed to create sandbox', message);
  }
}

export async function listSandboxes(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('sandboxes')
    .select('id, e2b_sandbox_id, repo_url, status, error_message, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw ApiError.internal('Failed to list sandboxes', error.message);
  }
  return data;
}

export async function getSandbox(userId: string, sandboxRowId: string) {
  const { data, error } = await supabaseAdmin
    .from('sandboxes')
    .select('id, e2b_sandbox_id, repo_url, status, error_message, created_at, updated_at')
    .eq('id', sandboxRowId)
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw ApiError.notFound('Sandbox not found');
  }
  return data;
}

/**
 * Verifies the sandbox belongs to the user and is usable, then connects to
 * it — transparently resuming it if it was paused (full filesystem/memory
 * state intact), flipping its row back to `ready` when that happens. Shared
 * by every module that needs to run something inside a sandbox (files, git,
 * opencode, servers).
 */
export async function connectToSandbox(userId: string, sandboxRowId: string): Promise<Sandbox> {
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

/**
 * Runs opencode non-interactively inside a ready sandbox with the given
 * prompt. Injects any AI provider keys the user has configured (e.g.
 * ANTHROPIC_API_KEY) so `model` can reference a paid provider; otherwise
 * opencode falls back to its own free-tier models.
 */
export async function runOpencode(userId: string, sandboxRowId: string, input: RunOpencodeInput) {
  const providerEnvVars = await getProviderEnvVars(userId);
  const sandbox = await connectToSandbox(userId, sandboxRowId);

  const modelArgs = input.model ? ['--model', shellQuote(input.model)] : [];
  const sessionArgs = input.sessionId ? ['--session', shellQuote(input.sessionId)] : [];
  const command = [
    'opencode',
    'run',
    shellQuote(input.prompt),
    '--format',
    'json',
    ...modelArgs,
    ...sessionArgs,
  ].join(' ');

  try {
    const result = await sandbox.commands.run(command, {
      cwd: SANDBOX_REPO_PATH,
      envs: providerEnvVars,
      timeoutMs: 180_000,
    });

    const events = parseOpencodeEvents(result.stdout);
    const { text, sessionId, error } = summarizeOpencodeEvents(events);

    return { text, sessionId, error, events, exitCode: result.exitCode };
  } catch (err) {
    // A non-zero exit from opencode itself (bad model, invalid key, etc.) is a
    // meaningful result to hand back to the caller, not a server failure.
    if (err instanceof CommandExitError) {
      const events = parseOpencodeEvents(err.stdout);
      const { text, sessionId, error } = summarizeOpencodeEvents(events);
      return {
        text,
        sessionId,
        error: error ?? err.stderr ?? 'opencode exited with an error',
        events,
        exitCode: err.exitCode,
      };
    }
    const message = err instanceof Error ? err.message : 'Unknown error running opencode';
    throw ApiError.internal('Failed to run opencode', message);
  }
}

/**
 * Pauses a sandbox: preserves its full filesystem (and by default memory)
 * state so opencode's chat/session history, the cloned repo, and any
 * uncommitted changes survive. Resuming happens transparently the next time
 * anything calls Sandbox.connect() on it (e.g. runOpencode, the terminal WS).
 * Use this instead of terminateSandbox for "the user is done for now" rather
 * than "delete this sandbox for good".
 */
export async function pauseSandbox(userId: string, sandboxRowId: string) {
  const row = await getSandbox(userId, sandboxRowId);

  if (row.status === 'terminated') {
    throw ApiError.badRequest('Sandbox is already terminated');
  }

  if (row.status !== 'paused' && row.e2b_sandbox_id) {
    try {
      const sandbox = await Sandbox.connect(row.e2b_sandbox_id, { apiKey: env.E2B_API_KEY });
      await sandbox.pause();
    } catch (err) {
      if (err instanceof SandboxNotFoundError) {
        // E2B already reaped it (e.g. idle timeout); nothing left to pause.
        await updateSandboxRow(row.id, { status: 'terminated' });
        return { id: row.id, status: 'terminated' as const };
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw ApiError.internal('Failed to pause sandbox', message);
    }
  }

  await updateSandboxRow(row.id, { status: 'paused' });
  return { id: row.id, status: 'paused' as const };
}

/** Permanently destroys a sandbox and all its state. Cannot be undone. */
export async function terminateSandbox(userId: string, sandboxRowId: string) {
  const row = await getSandbox(userId, sandboxRowId);

  if (row.status !== 'terminated' && row.e2b_sandbox_id) {
    try {
      const sandbox = await Sandbox.connect(row.e2b_sandbox_id, { apiKey: env.E2B_API_KEY });
      await sandbox.kill();
    } catch (err) {
      // Sandbox may have already expired/been reaped by E2B; treat as already terminated.
      void err;
    }
  }

  // Any background servers started in this sandbox are gone for good along
  // with it (unlike pauseSandbox, which preserves memory state and leaves
  // them running — see servers.service.ts).
  await supabaseAdmin
    .from('sandbox_servers')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('sandbox_id', row.id)
    .eq('status', 'running');

  await updateSandboxRow(row.id, { status: 'terminated' });
  return { id: row.id, status: 'terminated' as const };
}
