import { Sandbox } from 'e2b';
import { WebSocket } from 'ws';
import { env } from '../config/env';
import { verifySupabaseJwt } from '../middleware/auth';
import { getSandbox, markSandboxReady } from '../modules/sandboxes/sandboxes.service';

interface AuthedSandboxConnection {
  userId: string;
  sandboxRowId: string;
  sandbox: Sandbox;
}

/**
 * Shared handshake for sandbox-scoped WebSocket endpoints: verifies the
 * token (query param, since browsers can't set custom headers on a WS
 * handshake), checks the sandbox belongs to that user and is usable, then
 * connects to it (transparently resuming if paused). Closes `ws` with an
 * appropriate code and returns `null` on any failure.
 */
export async function authenticateSandboxSocket(
  ws: WebSocket,
  sandboxRowId: string,
  token: string | null
): Promise<AuthedSandboxConnection | null> {
  if (!token) {
    ws.close(4001, 'Missing token');
    return null;
  }

  let userId: string;
  try {
    const payload = await verifySupabaseJwt(token);
    userId = payload.sub;
  } catch {
    ws.close(4001, 'Invalid or expired token');
    return null;
  }

  let row;
  try {
    row = await getSandbox(userId, sandboxRowId);
  } catch {
    ws.close(4004, 'Sandbox not found');
    return null;
  }

  if ((row.status !== 'ready' && row.status !== 'paused') || !row.e2b_sandbox_id) {
    ws.close(4009, 'Sandbox is not ready');
    return null;
  }

  try {
    const sandbox = await Sandbox.connect(row.e2b_sandbox_id, { apiKey: env.E2B_API_KEY });
    if (row.status === 'paused') {
      await markSandboxReady(row.id);
    }
    return { userId, sandboxRowId, sandbox };
  } catch {
    ws.close(4010, 'Failed to connect to sandbox');
    return null;
  }
}
