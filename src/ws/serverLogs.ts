import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../config/logger';
import { getRunningServerForLogs } from '../modules/sandboxes/servers.service';
import { verifySupabaseJwt } from '../middleware/auth';

const SERVER_LOGS_PATH_RE = /^\/api\/v1\/sandboxes\/([0-9a-f-]{36})\/servers\/(\d+)\/logs$/i;

function sendEvent(ws: WebSocket, event: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/**
 * Attaches a WebSocket relay that streams a running background server's
 * stdout/stderr live, by attaching to its already-running process
 * (sandbox.commands.connect(pid)) rather than starting a new one.
 *
 * Protocol: client connects to
 * `wss://.../api/v1/sandboxes/:id/servers/:port/logs?token=<access_token>`.
 * The server streams back `{"type":"stdout"|"stderr","data":"..."}` frames as
 * the process produces output, and `{"type":"exit","exitCode":N}` if the
 * process ends while a client is attached.
 *
 * Unlike the terminal WebSocket, closing this connection does NOT stop the
 * server process — this is a read-only log tail, and the whole point of a
 * background server is that it keeps running after you stop watching it.
 *
 * Requires a long-lived process, same as the other sandbox WebSockets.
 */
export function attachServerLogsServer(server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = SERVER_LOGS_PATH_RE.exec(url.pathname);
    if (!match) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1], Number(match[2]), url.searchParams.get('token'));
    });
  });

  wss.on(
    'connection',
    async (ws: WebSocket, _req: IncomingMessage, sandboxRowId: string, port: number, token: string | null) => {
      if (!token) {
        ws.close(4001, 'Missing token');
        return;
      }

      let userId: string;
      try {
        const payload = await verifySupabaseJwt(token);
        userId = payload.sub;
      } catch {
        ws.close(4001, 'Invalid or expired token');
        return;
      }

      let sandbox;
      let pid: number;
      try {
        const resolved = await getRunningServerForLogs(userId, sandboxRowId, port);
        sandbox = resolved.sandbox;
        pid = resolved.pid;
      } catch {
        ws.close(4004, 'No running server found on that port');
        return;
      }

      try {
        const handle = await sandbox.commands.connect(pid, {
          timeoutMs: 0,
          onStdout: (data) => sendEvent(ws, { type: 'stdout', data }),
          onStderr: (data) => sendEvent(ws, { type: 'stderr', data }),
        });

        // Report if the process exits while a client is attached, but never
        // let a rejection here (e.g. non-zero exit) become an unhandled
        // rejection — this promise settling is just a signal, not something
        // this handler needs to propagate further.
        handle
          .wait()
          .then((result) => sendEvent(ws, { type: 'exit', exitCode: result.exitCode }))
          .catch((err) => {
            const exitCode = err && typeof err === 'object' && 'exitCode' in err ? err.exitCode : undefined;
            sendEvent(ws, { type: 'exit', exitCode });
          });

        ws.on('close', () => {
          // Detach only — the server process keeps running. Killing it is a
          // separate, explicit action (DELETE /servers/:port).
          handle.disconnect().catch(() => undefined);
        });
      } catch (err) {
        logger.warn({ err, sandboxRowId, port, pid }, 'Failed to attach to server process for log streaming');
        ws.close(4010, 'Failed to attach to server process');
      }
    }
  );

  return wss;
}
