import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../config/logger';
import { authenticateSandboxSocket } from './wsAuth';

const TERMINAL_PATH_RE = /^\/api\/v1\/sandboxes\/([0-9a-f-]{36})\/terminal$/i;

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

function isResizeMessage(value: unknown): value is ResizeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'resize' &&
    typeof (value as Record<string, unknown>).cols === 'number' &&
    typeof (value as Record<string, unknown>).rows === 'number'
  );
}

/**
 * Attaches a WebSocket terminal relay to an existing HTTP server.
 *
 * Protocol: client connects to `wss://.../api/v1/sandboxes/:id/terminal?token=<access_token>`.
 * Binary frames from the client are keystrokes sent verbatim to the sandbox's PTY.
 * Text frames from the client are JSON control messages (currently only `{type:"resize",cols,rows}`).
 * All frames from the server are binary PTY output.
 *
 * Requires a long-lived process (this is why the app deploys via Docker, not
 * a serverless platform — serverless can't hold a WebSocket connection open).
 */
export function attachTerminalServer(server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = TERMINAL_PATH_RE.exec(url.pathname);
    if (!match) {
      // Not a terminal upgrade request; let other upgrade handlers (if any) deal with it.
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1], url.searchParams.get('token'));
    });
  });

  wss.on('connection', async (ws: WebSocket, _req: IncomingMessage, sandboxRowId: string, token: string | null) => {
    const auth = await authenticateSandboxSocket(ws, sandboxRowId, token);
    if (!auth) return;
    const { sandbox } = auth;

    let ptyPid: number | null = null;

    try {
      const handle = await sandbox.pty.create({
        cols: 80,
        rows: 24,
        onData: (data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        },
      });
      ptyPid = handle.pid;
    } catch (err) {
      logger.error({ err, sandboxRowId }, 'Failed to create PTY');
      ws.close(4011, 'Failed to start terminal');
      return;
    }

    ws.on('message', async (data: Buffer, isBinary: boolean) => {
      if (ptyPid === null) return;

      if (!isBinary) {
        try {
          const parsed: unknown = JSON.parse(data.toString('utf8'));
          if (isResizeMessage(parsed)) {
            await sandbox.pty.resize(ptyPid, { cols: parsed.cols, rows: parsed.rows });
          }
        } catch {
          // ignore malformed control messages
        }
        return;
      }

      try {
        await sandbox.pty.sendInput(ptyPid, new Uint8Array(data));
      } catch (err) {
        logger.warn({ err, sandboxRowId }, 'Failed to send input to PTY');
      }
    });

    ws.on('close', async () => {
      if (ptyPid !== null) {
        try {
          await sandbox.pty.kill(ptyPid);
        } catch {
          // sandbox/PTY may already be gone
        }
      }
    });
  });

  return wss;
}
