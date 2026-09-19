# e2b Mobile Backend

Production backend API for the e2b mobile app. Node.js + TypeScript + Express, backed by Supabase (Postgres, Auth), deployed as a standalone long-running process (Docker) — required because the interactive terminal and streaming opencode features depend on WebSockets, which serverless platforms like Vercel cannot support.

## Stack

- **Runtime**: Node.js 22+ (required by `@supabase/supabase-js`'s realtime client, which needs native `WebSocket`), TypeScript (strict mode)
- **Framework**: Express 4
- **Database / Auth**: Supabase (Postgres with Row Level Security, Supabase Auth)
- **Validation**: Zod
- **Logging**: pino (structured JSON, redacts secrets)
- **Sandboxes**: E2B (`e2b` SDK) for on-demand code execution environments, `ws` for the interactive terminal + streaming opencode relays (standalone/Docker only, see below)
- **Deployment**: Docker on any long-running host (Fly.io, Railway, a VPS, etc.) — not Vercel/serverless, see below

## Architecture

```
src/
  app.ts              # Express app factory (middleware + routes wiring)
  server.ts           # App entrypoint (also attaches the WebSocket servers)
  config/             # Env validation (Zod) + logger
  lib/                # Supabase clients, ApiError, asyncHandler
  middleware/         # auth, validation, rate limiting, error handling, request id
  modules/
    auth/             # signup, login, refresh, logout, forgot-password
    users/            # profile read/update (RLS-enforced via user-scoped client)
    github/           # GitHub OAuth connect flow, encrypted token storage, repo listing
    ai-provider/      # Encrypted storage of user AI provider keys (anthropic/openai/openrouter/google)
    sandboxes/        # E2B sandbox creation, repo clone, opencode runs, files, git, background servers
    health/           # /healthz (liveness), /readyz (readiness)
  types/              # Express request augmentation
  ws/                 # WebSocket terminal, streaming opencode, and server-logs relays
supabase/
  migrations/         # SQL migrations (profiles, github_connections, sandboxes, oauth_states, ai_provider_keys, sandbox_servers)
```

Two Supabase clients are used deliberately:
- **`supabaseAdmin`** (secret key): bypasses RLS. Used only for trusted server-side operations (creating accounts, admin tasks, the GitHub/sandbox tables which have no client-facing write policies).
- **`createUserScopedClient(token)`**: authenticates as the requesting user via their JWT, so every query runs through Postgres Row Level Security. Used for all per-user data access (e.g. profile reads/updates) so authorization is enforced at the database layer, not just in application code.

### GitHub connect + E2B sandbox flow

1. Mobile client calls `POST /api/v1/integrations/github/connect` (authenticated) → gets back a GitHub authorize URL, opens it in a browser/webview.
2. User approves on GitHub → GitHub redirects to `GET /api/v1/integrations/github/callback?code=...&state=...`. The `state` was bound server-side to the user at step 1 (`oauth_states` table, 10 min TTL, single use) since GitHub's redirect carries no auth header of ours.
3. Callback exchanges the code for an access token, fetches the GitHub identity, and stores the token **encrypted at rest** (AES-256-GCM, see `src/lib/crypto.ts`) in `github_connections`.
4. Mobile client calls `POST /api/v1/sandboxes` with a `repoUrl` (must belong to that GitHub account or be accessible with their token) → backend creates an E2B sandbox (`e2b` SDK) and clones the repo into it using the decrypted token, tracking status in the `sandboxes` table.
5. `GET /api/v1/sandboxes` / `GET /api/v1/sandboxes/:id` to poll status; `POST /api/v1/sandboxes/:id/pause` pauses it (see below); `DELETE /api/v1/sandboxes/:id` permanently kills it.

### Sandbox pause/resume (don't lose opencode's chat history, env vars, or repo state)

E2B sandboxes are ephemeral — a **killed** sandbox is gone forever, along with everything inside it (opencode's session/chat history in `~/.local/share/opencode`, any injected env vars, uncommitted repo changes). To avoid losing that:

- **Every sandbox is created with `lifecycle: { onTimeout: { action: 'pause' }, autoResume: true }`** (`src/lib/e2b.ts`) — so when E2B's own idle timeout is hit, the sandbox is **paused** (full filesystem + memory snapshot), not killed. This is automatic; nothing in application code needs to detect idleness.
- **`POST /api/v1/sandboxes/:id/pause`** lets a client explicitly pause a sandbox it's done with for now (e.g. the user closed the app) without losing state, as an alternative to `DELETE` (which is permanent).
- **Resuming is transparent**: `Sandbox.connect(id)` (used by both `runOpencode` and the terminal WebSocket) automatically resumes a paused sandbox exactly where it left off — same opencode session history, same repo state. Both code paths flip the `sandboxes.status` row back to `ready` once resumed.
- Use `DELETE /api/v1/sandboxes/:id` only when the sandbox (and its state) should be gone for good — e.g. the user explicitly deletes a project.

The decrypted GitHub token is only ever held in memory for the duration of a request (fetching repos, cloning) — it is never logged or returned to clients.

### Interactive terminal (WebSocket)

`src/ws/terminal.ts` attaches a WebSocket relay to the HTTP server so a client can get a real, interactive shell inside a sandbox — useful for a mobile/web client that wants a terminal view, not just one-shot commands.

- **Connect**: `wss://<host>/api/v1/sandboxes/:id/terminal?token=<supabase_access_token>` (the JWT goes in the query string since browser WebSocket clients can't set custom headers on the handshake).
- **Auth/ownership**: the token is verified via JWKS (same as HTTP requests), then the sandbox row is looked up and must belong to that user and be in `ready` status — otherwise the socket is closed with a 4xxx code before any PTY is created.
- **Protocol**: binary frames are raw bytes in both directions (keystrokes in, PTY output out — like an xterm data stream). Text frames from the client are JSON control messages, currently just `{"type":"resize","cols":N,"rows":N}` for terminal resize.
- **Lifecycle**: one PTY per WebSocket connection; closing the socket kills the PTY (but not the sandbox itself, which keeps running — or auto-pauses on idle timeout, see below — until explicitly terminated via `DELETE /api/v1/sandboxes/:id`).

Requires a long-lived process (local `npm run dev`, or Docker on Fly.io/Railway/a VPS/etc.) — this is the reason this app does **not** deploy to Vercel or any other serverless platform: those cannot hold a WebSocket connection open (each invocation is a short-lived request/response).

### opencode (AI coding agent in the sandbox)

The default sandbox template (`E2B_TEMPLATE_ID`) comes with [opencode](https://opencode.ai) preinstalled, so a sandbox can run an AI coding agent against the cloned repo, not just execute plain shell commands. Every run uses `opencode run --format json`, parsed by `src/lib/opencodeEvents.ts` into typed events (`tool_use`, `text`, `step_finish`, `error`) shared by both the blocking and streaming endpoints below.

- **Free tier by default**: with no configured provider key, `opencode` can use its own free-tier models (e.g. `opencode/mimo-v2.5-free`) — no credentials needed. The free model lineup rotates; call `opencode models` inside a sandbox (or just omit `model` and let opencode pick) if a specific free model 404s.
- **Bring your own provider key**: `PUT /api/v1/integrations/ai-provider` stores a user's API key for `anthropic`, `openai`, `openrouter`, or `google`, **encrypted at rest** (same AES-256-GCM scheme as GitHub tokens, see `src/lib/crypto.ts`). Both opencode endpoints decrypt whichever keys the user has configured and inject them as the provider's standard env var (`ANTHROPIC_API_KEY`, etc.) when running the command — `opencode` then picks them up automatically, no extra login step. Pass `model` (e.g. `"anthropic/claude-sonnet-5"`) to use it.
- **Multi-turn conversations**: pass `sessionId` (from a previous response) to continue that exact opencode session instead of starting fresh — `opencode`'s own session history (stored in the sandbox's filesystem) provides the context.
- **Blocking response shape** (`POST .../opencode`): `{ text, sessionId, error, events, exitCode }` — `text` is the concatenated assistant reply, `events` is the full typed event list (useful for rendering tool-call steps), `error` is set when the run failed before producing a reply. A non-zero `exitCode` is returned as a normal `200`, not an HTTP error, since it's a meaningful result for the caller to show the user.
- **Streaming** (`WS .../opencode/stream`): see below — same events, delivered live instead of all at once.
- **Injection safety**: the prompt, model, and session id are POSIX-shell-quoted (`src/lib/shellQuote.ts`, unit-tested against real shell execution) before being placed in the command string run inside the sandbox — a prompt containing `` ` ``, `$()`, `;`, quotes, etc. is passed to opencode as inert literal text, never interpreted by the shell.
- **Sandbox template version drift**: `opencode`'s free tier occasionally requires a newer CLI version than what's baked into the E2B template (seen: template had 1.17.13, free tier started requiring 1.18.0+, breaking every free-tier run with an HTTP 426 until fixed). `createSandboxWithRepo` runs a best-effort `opencode upgrade` once per sandbox right after cloning (non-fatal if it fails/times out) so this self-heals without needing to rebuild the template for every such bump.

### opencode session history

Unlike the run endpoints above (which only accept a `sessionId` to *continue* a conversation), these let a client fetch history for sessions that already exist — useful for restoring a chat after the app is closed/reopened, since nothing about a session lives in our own database; it's entirely opencode's own state inside the sandbox filesystem.

- **`GET /api/v1/sandboxes/:id/opencode/sessions`** — lists sessions in the sandbox (`opencode session list`, table output parsed since the CLI has no JSON flag for this subcommand). Returns `[{ id, title, updated }]`.
- **`GET /api/v1/sandboxes/:id/opencode/sessions/:sessionId`** — full message history for one session (`opencode export`), parsed into the same event vocabulary as the streaming/blocking endpoints (`text`, `tool_use`, `step_finish`, `error`) grouped by message, so history and live messages can share rendering code. Returns `{ sessionId, title, messages: [{ id, role, createdAt, events }] }`. `404` if the session id doesn't exist.

### Streaming opencode (WebSocket)

`src/ws/opencodeStream.ts` streams `opencode`'s events live as they're produced (tool calls, partial text, step completion), instead of blocking for up to 3 minutes like the plain `POST` endpoint — needed for a responsive chat-style UI.

- **Connect**: `wss://<host>/api/v1/sandboxes/:id/opencode/stream?token=<supabase_access_token>`.
- **Protocol**: send `{"type":"run","prompt":"...","model"?:"...","sessionId"?:"..."}` as a text frame to start a turn. The server streams back one JSON text frame per opencode event, then a final `{"type":"done","sessionId","exitCode"}`. The connection stays open across turns — send another `run` message (with the `sessionId` from `done`) to continue the conversation on the same socket.
- **Race-safety**: the socket is paused immediately on connect and only resumed once the auth handshake finishes, so a client that sends its first message the instant the socket opens can never have it dropped before the message listener is attached.
- Requires a long-lived process, same as the terminal WebSocket (see above).

### File browser/editor

`GET/PUT/DELETE /api/v1/sandboxes/:id/files...` let a client browse and edit the cloned repo's files directly (for a code-editor view), without going through the terminal.

- All paths are relative to the repo root and resolved via `src/lib/safePath.ts` (unit-tested against real traversal attempts) — a path like `../../etc/passwd` is rejected with `400`, never resolved outside the repo directory.
- Reads are capped at 1MB per file (`400` if larger) to keep responses reasonable; `.git` is filtered out of directory listings.

### Git commit/push

`POST /api/v1/sandboxes/:id/git/commit` stages all changes and commits (configuring a default git identity if none is set); `POST .../git/push` pushes the current or given branch using the user's decrypted GitHub token, the same way cloning does.

- Git is invoked directly via `sandbox.commands.run('git ...')` rather than the E2B SDK's `Git` class, which is deprecated as of the current `e2b` version.
- **Credential redaction**: git's own output (e.g. the "branch set up to track '...'" message from `--set-upstream`) can echo back the authenticated remote URL verbatim, including the token. `src/lib/redactCredentials.ts` (unit-tested) strips any embedded `user:token@` credentials from all git stdout/stderr before it's returned in an API response — verified this actually would have leaked the token before the fix was added.

### Background servers (e.g. running a dev server and getting a public URL)

Lets a client start a long-running command inside a sandbox (`npm run dev`, `python manage.py runserver`, anything that binds a port) and get back a real, publicly reachable URL for it — using E2B's `sandbox.getHost(port)`, which returns a hostname in the form `<port>-<sandboxId>.e2b.app`.

- **`POST /api/v1/sandboxes/:id/servers`** — `{ command?, port }`. Runs the command as a background process (`sandbox.commands.run(cmd, { background: true })` — critical: without `background: true` the call blocks forever for a server process that never exits on its own) and returns `{ id, port, url, pid, command, status }`. **`command` is optional** — if omitted, the repo directory is served as static files instead (`python3 -m http.server <port>`), useful for quickly previewing a built/static site without needing to know or type a command. Rejects with `409` if a server is already `running` on that port.
- **`GET /api/v1/sandboxes/:id/servers`** — lists servers tracked for the sandbox (in the `sandbox_servers` table). Each `running` row is re-verified against the sandbox's actual live process list (`sandbox.commands.list()`) on every call, since a process can crash or exit on its own between requests — a row believed `running` that's no longer alive is corrected to `stopped` before the response is sent.
- **`DELETE /api/v1/sandboxes/:id/servers/:port`** — kills the process (`sandbox.commands.kill(pid)`) and marks the row `stopped`.
- **Why a DB table at all**: a fresh `Sandbox.connect()` per request has no memory of what a previous request started — E2B's own `commands.list()` can tell you a PID is alive but has no notion of "port", so `sandbox_servers` is the source of truth for the port↔command↔URL mapping, while liveness is always independently re-checked against the sandbox.
- **Persistence across pause/resume vs. terminate**: pausing a sandbox preserves full memory state, so a running server survives a pause/resume cycle — its row is left `running`. Terminating a sandbox destroys everything, so `terminateSandbox` marks every `running` server row for it `stopped`.

### Live server logs (WebSocket)

`WS /api/v1/sandboxes/:id/servers/:port/logs?token=<access_token>` streams a running server's stdout/stderr live, by **attaching** to its already-running process (`sandbox.commands.connect(pid)`) rather than starting a new one.

- Frames are `{"type":"stdout"|"stderr","data":"..."}` as output is produced, and a final `{"type":"exit","exitCode":N}` if the process ends while a client is attached.
- **Closing this connection does not stop the server** — it calls `handle.disconnect()` (detach only), not `kill()`. The whole point of a background server is that it keeps running after you stop watching its logs; stopping it is the separate, explicit `DELETE /servers/:port`.
- Verified live: started a real server, streamed real access-log lines over the socket as requests hit it, closed the socket, confirmed the server was still running and reachable afterward.

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Supabase project values
npm run dev            # starts on http://localhost:2345 with hot reload
```

Required env vars (see `.env.example`): Supabase project URL, publishable key, secret key (Project Settings → API Keys), and the JWKS URL (Project Settings → API → JWT Settings) used to verify access tokens.

### Database setup

Apply the migration in `supabase/migrations/0001_init_profiles.sql` via the Supabase SQL editor or the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This creates the `profiles`, `github_connections`, `sandboxes`, `oauth_states`, `ai_provider_keys`, and `sandbox_servers` tables with RLS policies so users can only read their own rows (writes to all but `profiles` happen exclusively via the server-side secret-role client).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (production) |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` / `lint:fix` | Lint (and auto-fix) |
| `npm test` | Run the test suite (Vitest) |

## API overview

All routes are prefixed `/api/v1` except health checks.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | none | Liveness check |
| GET | `/readyz` | none | Readiness check (verifies Supabase connectivity) |
| POST | `/api/v1/auth/signup` | none | Create account |
| POST | `/api/v1/auth/login` | none | Log in, returns access + refresh tokens |
| POST | `/api/v1/auth/refresh` | none | Exchange refresh token for new session |
| POST | `/api/v1/auth/forgot-password` | none | Send password reset email |
| POST | `/api/v1/auth/logout` | bearer | Invalidate current session |
| GET | `/api/v1/auth/me` | bearer | Current user claims from JWT |
| GET | `/api/v1/users/me` | bearer | Full profile row (RLS-enforced) |
| PATCH | `/api/v1/users/me` | bearer | Update profile fields |
| POST | `/api/v1/integrations/github/connect` | bearer | Start GitHub OAuth, returns authorize URL |
| GET | `/api/v1/integrations/github/callback` | none (GitHub redirect) | OAuth callback, stores encrypted token |
| GET | `/api/v1/integrations/github/status` | bearer | Whether GitHub is connected |
| DELETE | `/api/v1/integrations/github/disconnect` | bearer | Remove stored GitHub connection |
| GET | `/api/v1/integrations/github/repos` | bearer | List the connected account's repos |
| PUT | `/api/v1/integrations/ai-provider` | bearer | Set/update an AI provider API key (`anthropic`, `openai`, `openrouter`, `google`) |
| GET | `/api/v1/integrations/ai-provider` | bearer | List configured providers (never returns the key itself) |
| DELETE | `/api/v1/integrations/ai-provider/:provider` | bearer | Remove a stored provider key |
| POST | `/api/v1/sandboxes` | bearer | Create an E2B sandbox and clone a repo into it |
| GET | `/api/v1/sandboxes` | bearer | List the user's sandboxes |
| GET | `/api/v1/sandboxes/:id` | bearer | Get one sandbox's status |
| DELETE | `/api/v1/sandboxes/:id` | bearer | Permanently terminate a sandbox |
| POST | `/api/v1/sandboxes/:id/pause` | bearer | Pause a sandbox (resumable, preserves state) |
| POST | `/api/v1/sandboxes/:id/opencode` | bearer | Run `opencode` once, blocking until done (accepts `sessionId` to continue a conversation) |
| GET | `/api/v1/sandboxes/:id/opencode/sessions` | bearer | List opencode sessions that exist in the sandbox |
| GET | `/api/v1/sandboxes/:id/opencode/sessions/:sessionId` | bearer | Full message history for one opencode session |
| GET | `/api/v1/sandboxes/:id/files?path=.` | bearer | List a directory in the cloned repo |
| GET | `/api/v1/sandboxes/:id/files/content?path=...` | bearer | Read a file's content |
| PUT | `/api/v1/sandboxes/:id/files/content` | bearer | Write (create/overwrite) a file |
| DELETE | `/api/v1/sandboxes/:id/files/content?path=...` | bearer | Delete a file |
| GET | `/api/v1/sandboxes/:id/git/status` | bearer | Current branch + changed files |
| POST | `/api/v1/sandboxes/:id/git/commit` | bearer | Stage all changes and commit |
| POST | `/api/v1/sandboxes/:id/git/push` | bearer | Push the current (or given) branch using the user's GitHub token |
| POST | `/api/v1/sandboxes/:id/servers` | bearer | Start a background server (e.g. `npm run dev`), returns its public URL |
| GET | `/api/v1/sandboxes/:id/servers` | bearer | List servers started in this sandbox (re-verifies liveness) |
| DELETE | `/api/v1/sandboxes/:id/servers/:port` | bearer | Stop a running server |
| WS | `/api/v1/sandboxes/:id/terminal?token=<access_token>` | token query param | Interactive terminal into the sandbox (see below) |
| WS | `/api/v1/sandboxes/:id/opencode/stream?token=<access_token>` | token query param | Streamed `opencode` runs, event by event (see below) |
| WS | `/api/v1/sandboxes/:id/servers/:port/logs?token=<access_token>` | token query param | Live stdout/stderr from a running server (see below) |

All error responses share a consistent shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {}, "requestId": "..." } }
```

**Create-vs-fetch response shape convention**: a resource-creating `POST` (`POST /sandboxes`, `POST /sandboxes/:id/servers`) returns only the fields known at creation time (e.g. sandbox: `{id, sandboxId, repoUrl, status}`; server: `{id, port, url, pid, command, status}`) — it does not re-fetch the full row. The corresponding `GET` (list or by-id) returns the full row, including `error_message`, `created_at`, `updated_at`, etc. This is deliberate (avoids an extra DB round-trip on the hot path of "just created it"), not an oversight — a client should model these as distinct types rather than one loose shape if it wants full type safety.

## Production hardening included

- Helmet security headers, CORS allowlist (`CORS_ORIGINS` env var)
- Global + auth-specific rate limiting (`express-rate-limit`)
- Request body size limits (1mb)
- Structured JSON logging with request IDs and secret redaction
- Centralized error handling with typed `ApiError` and Zod validation errors
- Graceful shutdown on SIGTERM/SIGINT, crash-safe unhandled rejection/exception logging
- Strict TypeScript, no `any` leakage in request typing
- RLS-first data access: application code cannot accidentally read another user's data through the user-scoped client

## Deployment

**Must run as a long-lived process — not on Vercel or any other serverless platform.** The interactive terminal and streaming opencode features hold a WebSocket connection open per active session, which serverless functions (Vercel included) cannot support: each invocation there is a short-lived request/response, not a persistent connection.

### Render (free tier, no card required)

`render.yaml` (Blueprint) is already set up — Render reads it automatically when you connect this repo:

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint** → connect this repo.
2. Render provisions the web service from `render.yaml`. It will prompt for every env var marked `sync: false` (all secrets, plus `APP_URL` and `GITHUB_OAUTH_REDIRECT_URI`) — fill these in from `.env.example`.
3. `APP_URL` and `GITHUB_OAUTH_REDIRECT_URI` need the service's actual URL, which Render only assigns after the first deploy (`https://<service-name>.onrender.com`) — deploy once, copy the URL, then set those two vars and redeploy. Also update the GitHub OAuth App's Authorization callback URL to match.
4. Render injects its own `PORT`; the app already reads `process.env.PORT` so no code change is needed.

**Free tier tradeoff**: the free plan spins the service down after 15 minutes of inactivity and takes 30-60s to cold-start on the next request. Combined with a paused E2B sandbox also needing to resume, the first request after idle time can be slow — a WebSocket client should tolerate a delayed connection rather than timing out immediately.

### Docker (any long-running host — Fly.io, Railway, a VPS, etc.)

```bash
docker build -t e2b-backend .
docker run -p 2345:2345 --env-file .env e2b-backend
```

Set all of the env vars from `.env.example` on whichever host runs the container (each platform has its own way to inject env vars — e.g. `fly secrets set`, Railway's dashboard, or a mounted `.env` file on a VPS). Fly.io and Railway both require a card on file even for their free allowances; Render does not.

## Next steps to consider as the app grows

- **Push notifications** — nothing exists yet for notifying a user when a long-running opencode task finishes while the app is backgrounded/closed (no device token storage, no push integration).
- **Per-user resource limits/usage tracking** — no quota on sandbox count or E2B/provider spend per user yet.
- Onboarding/account deletion flows, Sentry (or similar) for error tracking, an OpenAPI spec generated from the Zod schemas for mobile client codegen, per-user (not just per-IP) rate limiting.
- Add remaining domain modules following the `modules/<name>/{routes,service,schemas}.ts` pattern.
- If background jobs/queues are needed later, a dedicated queue/worker process is still the right shape even on a long-running host — keeps request handling and background work decoupled.
