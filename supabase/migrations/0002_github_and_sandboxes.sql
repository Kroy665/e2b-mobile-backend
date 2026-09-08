-- Stores each user's GitHub OAuth connection. Tokens are encrypted at rest
-- by the application layer (AES-256-GCM, see src/lib/crypto.ts) before
-- insert; this table never sees plaintext tokens.
create table if not exists public.github_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  scope text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.github_connections enable row level security;

create policy "github_connections_select_own" on public.github_connections
  for select using (auth.uid() = user_id);

-- Inserts/updates happen server-side only (via the secret-role client during
-- the OAuth callback), so no write policy is granted to authenticated/anon.

drop trigger if exists github_connections_set_updated_at on public.github_connections;
create trigger github_connections_set_updated_at
  before update on public.github_connections
  for each row execute function public.set_updated_at();

-- Tracks E2B sandboxes created on behalf of a user, so a user can only see
-- and act on sandboxes they created.
create table if not exists public.sandboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  e2b_sandbox_id text not null,
  repo_url text not null,
  status text not null default 'creating' check (status in ('creating', 'ready', 'failed', 'terminated')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sandboxes enable row level security;

create policy "sandboxes_select_own" on public.sandboxes
  for select using (auth.uid() = user_id);

-- Inserts/updates happen server-side only (via the secret-role client),
-- since sandbox lifecycle is driven by the backend, not directly by clients.

drop trigger if exists sandboxes_set_updated_at on public.sandboxes;
create trigger sandboxes_set_updated_at
  before update on public.sandboxes
  for each row execute function public.set_updated_at();

create index if not exists sandboxes_user_id_idx on public.sandboxes (user_id);
