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

## RESOLVED: intermittent RLS failures ("new row violates row-level security policy")

This surfaced repeatedly throughout testing on `profiles`, `oauth_states`, `sandboxes`, and `ai_provider_keys` inserts, and was initially misdiagnosed as a Supabase platform issue (see git history for the earlier, incorrect writeup). **Root cause found and fixed on 2026-09-08.**

**Actual cause**: `login()` and `refreshSession()` in `src/modules/auth/auth.service.ts` called `supabaseAdmin.auth.signInWithPassword(...)` and `supabaseAdmin.auth.refreshSession(...)` directly on the shared, module-level `supabaseAdmin` singleton. Both of those SDK methods set an **in-memory session on the client instance itself** — `persistSession: false` only controls whether that session is written to disk/localStorage, not whether it's held in memory for the lifetime of the client. Since `supabaseAdmin` is reused across every request in the process, the moment *any* user logged in, every concurrent or subsequent request using `supabaseAdmin` silently started authenticating as **that user's session** instead of the service role — until another login overwrote it again, or nothing did and it stuck. This explains every symptom observed:
- Confirmed directly: a temporary diagnostic endpoint dumped `jwt_claims` mid-failure and showed `"role":"authenticated"`, `"sub":"<a real user id>"`, `"session_id":"..."` — i.e. `supabaseAdmin` was authenticating as a specific logged-in user, not `service_role`.
- Why one-shot scripts never reproduced it: they never called `login()`, so `supabaseAdmin` never got a session set on it.
- Why it correlated loosely with uptime/restarts: purely a function of whether *any* login had happened yet on that process instance, not any actual time-based expiry.
- Why a restart "fixed" it: a fresh process's `supabaseAdmin` has no session set until the first login happens.

**Fix**: `src/lib/supabase.ts` adds `createFreshAuthClient()` — a throwaway client (publishable key, never reused) for exactly this kind of session-mutating call. `login()` and `refreshSession()` now use it instead of `supabaseAdmin`. Verified other `supabaseAdmin.auth.*` call sites (`admin.createUser`, `admin.signOut`, `resetPasswordForEmail`) are safe as-is — checked the `@supabase/auth-js` source directly; none of them mutate client-side session state, they're plain API calls.

**Verification**: reproduced the failure live in production (`jwt_claims` showing a user's session on `supabaseAdmin`), applied the fix, confirmed `login`/`refreshSession` still work correctly and `supabaseAdmin` inserts no longer fail after logins occur.

## Not yet built / not tested because the feature doesn't exist

- Push notifications (no device token storage, no push integration)
- Per-user resource/quota limits on sandbox creation or AI provider spend
- Account deletion flow
- Streaming opencode tested only with the free tier + Google's real key path was tested on the **blocking** endpoint, not the **streaming** endpoint — the streaming WS has not been tested with a real (non-free-tier) provider key
