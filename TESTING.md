# Testing Status

Tracks what has actually been exercised with a real live request (against the real Supabase project, real E2B sandboxes, real GitHub account) versus what is only covered by automated unit tests, versus what is genuinely untested. Last updated: 2026-09-08.

Automated test suite: `npm test` — 28 tests across 8 files, all passing. These cover validation logic and pure functions (`shellQuote`, `safePath`, `redactCredentials`, `crypto`, opencode event parsing) but do **not** hit a real Supabase DB or a real E2B sandbox — that verification only happened via manual live testing, documented below.

## Legend
- ✅ Tested live, working as expected
- 🐛 Tested live, bug found — fixed and re-verified
- ⚠️ Partially tested (see note)
- ❌ Not tested at all

---

## Auth (`/api/v1/auth/*`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /signup | 🐛→✅ | Found: `email_confirm: false` made login impossible for any new user. Fixed to `true`, re-verified signup→login works end-to-end. |
| POST /login | ✅ | Correct password, wrong password (401), duplicate email (409). |
| POST /refresh | ✅ | Valid refresh token, invalid/garbage token (401). |
| POST /forgot-password | ⚠️ | Returns 500 for `@example.com` test addresses (Supabase rejects the domain as non-deliverable) — this is expected Supabase behavior for a fake domain, not verified against a real email address. |
| POST /logout | ✅ | Confirmed access token remains valid until natural JWT expiry after logout — expected stateless-JWT behavior, not a bug. |
| GET /me | ✅ | |

## Users (`/api/v1/users/*`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /me | ✅ | |
| PATCH /me | ✅ | Valid update, empty body (400), invalid URL (400), over-length bio (400). |
| RLS cross-user isolation | ✅ | Two independent users each confirmed to see only their own profile row. |

## GitHub integration (`/api/v1/integrations/github/*`)

| Endpoint | Status | Notes |
|---|---|---|
| POST /connect | ✅ | Real OAuth authorize URL generated and used. |
| GET /callback | ✅ | Full real OAuth consent flow completed with a real GitHub account; encrypted token confirmed stored (not plaintext). |
| GET /status | ✅ | |
| DELETE /disconnect | ✅ | |
| GET /repos | ✅ | Listed real repos including private ones, confirming `repo` scope works. |

## AI provider keys (`/api/v1/integrations/ai-provider/*`)

| Endpoint | Status | Notes |
|---|---|---|
| PUT / | ✅ | Tested with both a fake key (plumbing check) and a **real Google Gemini key** (see below). |
| GET / | ✅ | Confirms the key itself is never returned. |
| DELETE /:provider | ✅ | |
| Real provider key end-to-end | ✅ | Real Gemini key → `opencode` run → correct model response (`"banana"`) → real cost accounting (`$0.00642375`) → confirmed 0 rows in DB after cleanup. |
| Real key for `anthropic` | ❌ | Only tested with a deliberately-fake key (correctly rejected by Anthropic). Never verified with a real Anthropic/OpenAI/OpenRouter key. |

## Sandboxes core (`/api/v1/sandboxes`)

| Endpoint | Status | Notes |
|---|---|---|
| POST / (create) | ✅ | Public repos, private repos, unrelated public repos (not owned by the connected account) — all clone correctly. |
| GET / (list) | ✅ | |
| GET /:id | ✅ | |
| DELETE /:id (terminate) | ✅ | Confirmed the underlying E2B sandbox is actually killed (reconnect attempt fails as expected). |
| POST /:id/pause | ✅ | Confirmed opencode session history and repo state survive a pause→resume cycle; confirmed auto-pause-on-idle-timeout config is accepted by E2B. |
| POST /:id/opencode | ✅ | Free tier, fake-key failure path (structured error surfaced correctly), real-key success path, multi-turn session continuation (`sessionId`). |

## Files (`/api/v1/sandboxes/:id/files/*`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /files (list) | ✅ | `.git` correctly filtered from listing. |
| GET /files/content (read) | ✅ | |
| PUT /files/content (write) | ✅ | |
| DELETE /files/content | 🐛→✅ | Found: deleting a nonexistent file returned `200` instead of `404` (`sandbox.files.remove()` doesn't throw on a missing path). Fixed by checking `exists()` first; re-verified both the 404 and 200 cases. |
| Path traversal defense | ✅ | `../../../etc/passwd`-style attempts correctly rejected with 400. |
| Large file (>1MB) read rejection | ❌ | Code path exists (`MAX_READABLE_FILE_SIZE` check) but never actually tested against a real oversized file. |

## Git (`/api/v1/sandboxes/:id/git/*`)

| Endpoint | Status | Notes |
|---|---|---|
| GET /status | ✅ | |
| POST /commit | ✅ | Including the "nothing to commit" rejection path. |
| POST /push | 🐛→✅ | Real push to a real owned repo (test branch, cleaned up after) succeeded. Found: git's own `--set-upstream` output echoed the full authenticated URL (including the GitHub token) back in the API response — a real credential leak. Fixed with `redactCredentials()`; re-verified the exact same push no longer leaks the token. |
| Push to a repo without write access | ✅ | Correctly surfaces GitHub's real 403 permission-denied error. |

## WebSockets

| Endpoint | Status | Notes |
|---|---|---|
| WS /terminal | ✅ | Real interactive shell session, ran real commands, correct output. Also tested connecting to a **paused** sandbox — confirmed transparent resume. |
| WS /opencode/stream | 🐛→✅ | Confirmed genuine incremental streaming (events arrive over ~20s, not buffered). Found: a client sending its first message immediately on `open` could have it dropped before the server's async auth handshake attached the message listener (race condition). Fixed by pausing the socket on connect and resuming only once ready; re-verified by sending immediately on open (no artificial delay) — works correctly. |

## Health

| Endpoint | Status | Notes |
|---|---|---|
| GET /healthz | ✅ | |
| GET /readyz | ✅ | Confirms real Supabase connectivity. |

---

## Known unresolved issue (not a code bug, but affects reliability)

**Intermittent Supabase RLS failures on insert**, surfaced repeatedly throughout testing as:
```
"new row violates row-level security policy for table \"...\""
```
Observed on `profiles`, `oauth_states`, `sandboxes`, and `ai_provider_keys` inserts — always via the `supabaseAdmin` (secret-key) client, which should bypass RLS via Postgres's `BYPASSRLS` role attribute (confirmed the role resolves correctly as `service_role` via a diagnostic RPC, both locally and while the bug was actively occurring). Also reproduced on the live Render deployment, not just local dev — ruling out anything specific to `tsx watch` or the local machine. Root cause not identified:
- Raw one-shot Node scripts using the identical client and identical calls **never** reproduce it — only requests through a long-running server process sometimes fail.
- A **full process restart** (local kill+restart, or a Render redeploy) reliably clears it every time it was hit; `tsx watch`'s in-place hot-reload restart does **not** reliably clear it.
- Statistical runs (15–20 consecutive requests) sometimes show 0% failure, sometimes fail consistently for a stretch, then clear on their own or after a restart.
- On the Render deployment, the failure was observed at ~967s (~16 min) of process uptime — matching a ~16 minute `iat`/`exp` window seen earlier in the internal service-role JWT that Supabase's platform derives from `SUPABASE_SECRET_KEY` (inspected via a temporary diagnostic RPC). This suggests the platform-side token exchange behind the newer `sb_secret_...` key format may not be refreshing correctly for long-lived server processes, though this is not confirmed.
- Ruled out: `autoRefreshToken` on the `supabaseAdmin` client — that option only governs refreshing a logged-in user's session (via their `refresh_token`); `supabaseAdmin` never establishes a session, so this setting cannot affect it either way (verified in `@supabase/auth-js` source).

Workaround: if this error appears, fully restart the process (local: kill and restart `npm run dev`, not just save a file; production: trigger a redeploy) rather than expecting it to self-heal quickly. Worth filing as a Supabase support ticket given it reproduces on their hosted platform with the new API key format, independent of anything in this codebase.

## Not yet built / not tested because the feature doesn't exist

- Push notifications (no device token storage, no push integration)
- Per-user resource/quota limits on sandbox creation or AI provider spend
- Account deletion flow
- Streaming opencode tested only with the free tier + Google's real key path was tested on the **blocking** endpoint, not the **streaming** endpoint — the streaming WS has not been tested with a real (non-free-tier) provider key
