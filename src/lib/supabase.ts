import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env';

/**
 * Secret-key client: bypasses Row Level Security. Use only for trusted
 * server-side operations (admin tasks, cross-user queries). Never expose
 * results of this client directly without authorization checks.
 *
 * KNOWN ISSUE: intermittent "new row violates row-level security policy"
 * errors have been observed on inserts through this client after the process
 * has been running for a while (roughly correlates with a ~16 minute window
 * seen in the internal service-role JWT's iat/exp, derived from
 * SUPABASE_SECRET_KEY by Supabase's platform). Root cause not yet confirmed;
 * a full process restart reliably clears it. Suspected to be a Supabase
 * platform-side issue with the newer sb_secret_ key format rather than
 * something fixable via client options here (autoRefreshToken does not apply
 * to this client — it only affects session refresh for a logged-in user, and
 * this client never establishes a session). See TESTING.md.
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
