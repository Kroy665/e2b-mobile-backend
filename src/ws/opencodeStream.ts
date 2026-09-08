import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { CommandExitError } from 'e2b';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../config/logger';
import { parseOpencodeEvents } from '../lib/opencodeEvents';
import { shellQuote } from '../lib/shellQuote';
import { getProviderEnvVars } from '../modules/ai-provider/ai-provider.service';
import { authenticateSandboxSocket } from './wsAuth';

const OPENCODE_PATH_RE = /^\/api\/v1\/sandboxes\/([0-9a-f-]{36})\/opencode\/stream$/i;
const SANDBOX_REPO_PATH = '/home/user/app';

interface RunMessage {
  type: 'run';
  prompt: string;
  model?: string;
  sessionId?: string;
}

function isRunMessage(value: unknown): value is RunMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).type === 'run' &&
    typeof (value as Record<string, unknown>).prompt === 'string'
  );
}

function sendEvent(ws: WebSocket, event: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/**
 * Attaches a WebSocket relay that streams `opencode run` output live, event
 * by event, instead of blocking until the whole run finishes (see the
 * blocking POST /api/v1/sandboxes/:id/opencode for the simpler alternative).
 *
 * Protocol: client connects to
 * `wss://.../api/v1/sandboxes/:id/opencode/stream?token=<access_token>`, then
 * sends `{"type":"run","prompt":"...","model"?:"...","sessionId"?:"..."}` as
 * a text frame per turn. The server streams back one JSON text frame per
 * opencode event (`{type:"tool_use"|"text"|"step_finish"|"error", ...}`),
 * plus a final `{"type":"done","sessionId","exitCode"}` per run. The
 * connection stays open for multiple turns; send another `run` message to
 * continue (pass the `sessionId` from `done` to keep context).
 *
 * Requires a long-lived process, same as the terminal relay — not available
 * on a serverless platform.
 */
export function attachOpencodeStreamServer(server: import('http').Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const match = OPENCODE_PATH_RE.exec(url.pathname);
    if (!match) return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1], url.searchParams.get('token'));
    });
  });

  wss.on('connection', async (ws: WebSocket, _req: IncomingMessage, sandboxRowId: string, token: string | null) => {
    // Pause the socket immediately so a client that sends its first message
    // right on `open` (before the async auth handshake below completes)
    // doesn't race past a not-yet-attached listener; resumed once ready.
    ws.pause();

    const auth = await authenticateSandboxSocket(ws, sandboxRowId, token);
    if (!auth) return;
    const { userId, sandbox } = auth;

    let running = false;

    ws.on('message', async (data: Buffer) => {
      if (running) {
        sendEvent(ws, { type: 'error', message: 'A run is already in progress on this connection' });
        return;
      }


      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        sendEvent(ws, { type: 'error', message: 'Malformed message: expected JSON' });
        return;
      }

      if (!isRunMessage(parsed)) {
        sendEvent(ws, { type: 'error', message: 'Expected {"type":"run","prompt":"..."}' });
        return;
      }

      running = true;
      let lineBuffer = '';

      try {
        const providerEnvVars = await getProviderEnvVars(userId);
        const modelArgs = parsed.model ? ['--model', shellQuote(parsed.model)] : [];
        const sessionArgs = parsed.sessionId ? ['--session', shellQuote(parsed.sessionId)] : [];
        const command = [
          'opencode',
          'run',
          shellQuote(parsed.prompt),
          '--format',
          'json',
          ...modelArgs,
          ...sessionArgs,
        ].join(' ');

        const flushEvents = (chunk: string) => {
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() ?? '';
          for (const event of parseOpencodeEvents(lines.join('\n'))) {
            sendEvent(ws, event);
          }
        };

        const result = await sandbox.commands.run(command, {
          cwd: SANDBOX_REPO_PATH,
          envs: providerEnvVars,
          timeoutMs: 180_000,
          onStdout: flushEvents,
        });

        if (lineBuffer.trim()) {
          for (const event of parseOpencodeEvents(lineBuffer)) sendEvent(ws, event);
        }

        const finalEvents = parseOpencodeEvents(result.stdout);
        const sessionId = finalEvents.find((e) => 'sessionId' in e && e.sessionId)?.sessionId ?? null;
        sendEvent(ws, { type: 'done', sessionId, exitCode: result.exitCode });
      } catch (err) {
        if (err instanceof CommandExitError) {
          const finalEvents = parseOpencodeEvents(err.stdout);
          const sessionId = finalEvents.find((e) => 'sessionId' in e && e.sessionId)?.sessionId ?? null;
          sendEvent(ws, { type: 'done', sessionId, exitCode: err.exitCode });
        } else {
          logger.error({ err, sandboxRowId }, 'opencode stream run failed');
          sendEvent(ws, { type: 'error', message: 'Failed to run opencode' });
        }
      } finally {
        running = false;
      }
    });

    ws.resume();
  });

  return wss;
}
