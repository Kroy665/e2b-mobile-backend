import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Secret-key client: bypasses Row Level Security. Use only for trusted
 * server-side operations (admin tasks, cross-user queries). Never expose
 * results of this client directly without authorization checks.
 *
 * IMPORTANT: never call session-mutating auth methods on this shared
 * singleton (`auth.signInWithPassword`, `auth.refreshSession`, `auth.signOut`,
 * etc. — anything other than the `auth.admin.*` namespace). Those methods set
 * an in-memory session on the client instance itself; since this client is
 * reused across every request in the process, one user's login would
 * silently downgrade every concurrent/subsequent request's identity to that
 * user until something else overwrote it — this was a real bug (see
 * TESTING.md) that caused intermittent RLS failures across unrelated tables.
 * Use `createFreshAuthClient()` for any such operation instead.
 */
export const supabaseAdmin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Creates a request-scoped client that runs queries as the authenticated
 * user (via their JWT), so Postgres RLS policies are enforced.
 */
export function createUserScopedClient(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

/**
 * Creates a brand-new, throwaway client for one-off auth operations that
 * mutate client-side session state (login, token refresh, etc.). Never
 * reused across requests, so it's safe for exactly this kind of call —
 * unlike `supabaseAdmin`, which must stay session-free for its whole
 * lifetime. Uses the publishable key, matching what a normal client-side
 * login would use.
 */
export function createFreshAuthClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
