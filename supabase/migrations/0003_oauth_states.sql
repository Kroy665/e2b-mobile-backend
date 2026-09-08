-- Short-lived state store for the GitHub OAuth flow. The callback endpoint
-- is hit by GitHub (no Authorization header from our app), so we bind the
-- opaque `state` value to the initiating user server-side here instead of
-- trusting a client-supplied user id.
create table if not exists public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

alter table public.oauth_states enable row level security;
-- No policies granted: this table is accessed exclusively via the
-- server-side secret-role client, never directly by clients.

create index if not exists oauth_states_expires_at_idx on public.oauth_states (expires_at);
