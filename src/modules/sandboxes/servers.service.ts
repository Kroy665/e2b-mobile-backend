import { Sandbox } from 'e2b';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import { supabaseAdmin } from '../../lib/supabase';
import { SANDBOX_REPO_PATH, connectToSandbox, getSandbox } from './sandboxes.service';
import { StartServerInput } from './servers.schemas';

interface ServerRow {
  id: string;
  sandbox_id: string;
  user_id: string;
  pid: number;
  port: number;
  command: string;
  url: string;
  status: 'running' | 'stopped' | 'failed';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

async function updateServerRow(id: string, patch: Partial<ServerRow>) {
  await supabaseAdmin
    .from('sandbox_servers')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Starts a command as a background process inside the sandbox and returns
 * the public URL for the given port (via sandbox.getHost(port)). The process
 * keeps running after this call returns; it is not tied to the lifetime of
 * this request. Tracked in `sandbox_servers` so it can be listed/stopped
 * across requests, since a fresh Sandbox.connect() has no memory of what a
 * previous request started.
 */
export async function startServer(userId: string, sandboxRowId: string, input: StartServerInput) {
  const sandbox = await connectToSandbox(userId, sandboxRowId);

  const { data: existing } = await supabaseAdmin
    .from('sandbox_servers')
    .select('id, status')
    .eq('sandbox_id', sandboxRowId)
    .eq('port', input.port)
    .maybeSingle<Pick<ServerRow, 'id' | 'status'>>();

  if (existing && existing.status === 'running') {
    throw ApiError.conflict(`A server is already running on port ${input.port}`);
  }

  let handle;
  try {
    handle = await sandbox.commands.run(input.command, {
      cwd: SANDBOX_REPO_PATH,
      background: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw ApiError.internal('Failed to start server', message);
  }

  const url = `https://${sandbox.getHost(input.port)}`;

  const row = {
    sandbox_id: sandboxRowId,
    user_id: userId,
    pid: handle.pid,
    port: input.port,
    command: input.command,
    url,
    status: 'running' as const,
    error_message: null,
  };

  const { data, error } = existing
    ? await supabaseAdmin.from('sandbox_servers').update(row).eq('id', existing.id).select().single<ServerRow>()
    : await supabaseAdmin.from('sandbox_servers').insert(row).select().single<ServerRow>();

  if (error || !data) {
    // The process is already running in the sandbox even though we failed to
    // record it — best-effort kill it so we don't leak an untracked server.
    await sandbox.commands.kill(handle.pid).catch(() => undefined);
    throw ApiError.internal('Failed to record server', error?.message);
  }

  return { id: data.id, port: data.port, url: data.url, pid: data.pid, command: data.command, status: data.status };
}

/**
 * Lists servers tracked for a sandbox, re-verifying each `running` one is
 * still actually alive in the sandbox (a process can die on its own — a crash,
 * `npm run dev` erroring out — without us finding out until we check).
 */
export async function listServers(userId: string, sandboxRowId: string) {
  // Confirms the sandbox belongs to this user even if there are no server
  // rows yet, so a caller can't probe another user's sandbox id via this route.
  await getSandbox(userId, sandboxRowId);

  const { data, error } = await supabaseAdmin
    .from('sandbox_servers')
    .select('id, pid, port, command, url, status, error_message, created_at, updated_at')
    .eq('sandbox_id', sandboxRowId)
    .order('created_at', { ascending: false });

  if (error) {
    throw ApiError.internal('Failed to list servers', error.message);
  }

  const runningRows = (data ?? []).filter((row) => row.status === 'running');
  if (runningRows.length === 0) {
    return data ?? [];
  }

  let sandbox: Sandbox | null = null;
  try {
    const row = await getSandbox(userId, sandboxRowId);
    if (row.e2b_sandbox_id) {
      sandbox = await Sandbox.connect(row.e2b_sandbox_id, { apiKey: env.E2B_API_KEY });
    }
  } catch {
    // If we can't connect, fall through and report rows as last recorded.
  }

  if (!sandbox) {
    return data ?? [];
  }

  const alivePids = new Set((await sandbox.commands.list().catch(() => [])).map((p) => p.pid));

  const results = await Promise.all(
    (data ?? []).map(async (row) => {
      if (row.status === 'running' && !alivePids.has(row.pid)) {
        await updateServerRow(row.id, { status: 'stopped' });
        return { ...row, status: 'stopped' as const };
      }
      return row;
    })
  );

  return results;
}

/** Stops a running server by port, killing its process inside the sandbox. */
export async function stopServer(userId: string, sandboxRowId: string, port: number) {
  await getSandbox(userId, sandboxRowId);

  const { data: row, error } = await supabaseAdmin
    .from('sandbox_servers')
    .select('id, pid, status')
    .eq('sandbox_id', sandboxRowId)
    .eq('port', port)
    .maybeSingle<Pick<ServerRow, 'id' | 'pid' | 'status'>>();

  if (error || !row) {
    throw ApiError.notFound(`No server found on port ${port}`);
  }

  if (row.status !== 'running') {
    return { port, status: row.status };
  }

  const sandbox = await connectToSandbox(userId, sandboxRowId);
  await sandbox.commands.kill(row.pid).catch(() => undefined);

  await updateServerRow(row.id, { status: 'stopped' });
  return { port, status: 'stopped' as const };
}

/**
 * Resolves a running server's sandbox + PID for the logs WebSocket to
 * connect to. Throws if the sandbox isn't the caller's, or no running server
 * exists on that port.
 */
export async function getRunningServerForLogs(
  userId: string,
  sandboxRowId: string,
  port: number
): Promise<{ sandbox: Sandbox; pid: number }> {
  const sandbox = await connectToSandbox(userId, sandboxRowId);

  const { data: row, error } = await supabaseAdmin
    .from('sandbox_servers')
    .select('pid, status')
    .eq('sandbox_id', sandboxRowId)
    .eq('port', port)
    .maybeSingle<Pick<ServerRow, 'pid' | 'status'>>();

  if (error || !row || row.status !== 'running') {
    throw ApiError.notFound(`No running server found on port ${port}`);
  }

  return { sandbox, pid: row.pid };
}
