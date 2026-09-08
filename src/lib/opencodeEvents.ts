/**
 * Parses the newline-delimited JSON event stream produced by
 * `opencode run --format json`. Each line is one event; a run typically
 * emits `step_start` -> (`tool_use`)* -> `text` -> `step_finish`, repeated
 * per assistant turn.
 */

export interface OpencodeToolUseEvent {
  type: 'tool_use';
  sessionId: string;
  tool: string;
  input: unknown;
  output: string | undefined;
  status: string | undefined;
}

export interface OpencodeTextEvent {
  type: 'text';
  sessionId: string;
  text: string;
}

export interface OpencodeStepFinishEvent {
  type: 'step_finish';
  sessionId: string;
  tokens: { total: number; input: number; output: number } | undefined;
  cost: number | undefined;
}

export interface OpencodeErrorEvent {
  type: 'error';
  sessionId: string;
  message: string;
}

export type OpencodeEvent =
  | OpencodeToolUseEvent
  | OpencodeTextEvent
  | OpencodeStepFinishEvent
  | OpencodeErrorEvent
  | { type: string; sessionId?: string };

interface RawEvent {
  type: string;
  sessionID?: string;
  error?: { name?: string; data?: { message?: string } };
  part?: {
    type?: string;
    tool?: string;
    text?: string;
    sessionID?: string;
    state?: { status?: string; input?: unknown; output?: string };
    tokens?: { total: number; input: number; output: number };
    cost?: number;
  };
}

/** Parses raw `--format json` stdout into a typed event list, skipping any unparseable lines. */
export function parseOpencodeEvents(rawOutput: string): OpencodeEvent[] {
  const events: OpencodeEvent[] = [];

  for (const line of rawOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let raw: RawEvent;
    try {
      raw = JSON.parse(trimmed) as RawEvent;
    } catch {
      continue;
    }

    const sessionId = raw.sessionID ?? raw.part?.sessionID ?? '';

    if (raw.type === 'tool_use' && raw.part) {
      events.push({
        type: 'tool_use',
        sessionId,
        tool: raw.part.tool ?? 'unknown',
        input: raw.part.state?.input,
        output: raw.part.state?.output,
        status: raw.part.state?.status,
      });
    } else if (raw.type === 'text' && raw.part?.text) {
      events.push({ type: 'text', sessionId, text: raw.part.text });
    } else if (raw.type === 'step_finish') {
      events.push({
        type: 'step_finish',
        sessionId,
        tokens: raw.part?.tokens,
        cost: raw.part?.cost,
      });
    } else if (raw.type === 'error') {
      events.push({
        type: 'error',
        sessionId,
        message: raw.error?.data?.message ?? raw.error?.name ?? 'Unknown opencode error',
      });
    } else {
      events.push({ type: raw.type, sessionId });
    }
  }

  return events;
}

/**
 * Extracts the final assistant reply (concatenated text events, or the error
 * message if the run failed before producing any text) and the session id.
 */
export function summarizeOpencodeEvents(events: OpencodeEvent[]): {
  text: string;
  sessionId: string | null;
  error: string | null;
} {
  const textEvents = events.filter((e): e is OpencodeTextEvent => e.type === 'text');
  const errorEvent = events.find((e): e is OpencodeErrorEvent => e.type === 'error');
  const sessionId = events.find((e) => 'sessionId' in e && e.sessionId)?.sessionId ?? null;

  return {
    text: textEvents.map((e) => e.text).join(''),
    sessionId,
    error: errorEvent?.message ?? null,
  };
}
