-- Tracks background servers (e.g. `npm run dev`) started inside a sandbox,
-- so a client can list/stop them across requests and reconnect a new
-- Sandbox.connect() to the right PID for streaming logs. E2B's own
-- sandbox.commands.list() can confirm a PID is still alive but has no notion
-- of "port" — this table is the source of truth for the port<->command
-- mapping; liveness is always re-verified against the sandbox itself.
create table if not exists public.sandbox_servers (
  id uuid primary key default gen_random_uuid(),
  sandbox_id uuid not null references public.sandboxes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pid integer not null,
  port integer not null check (port > 0 and port < 65536),
  command text not null,
  url text not null,
  status text not null default 'running' check (status in ('running', 'stopped', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sandbox_id, port)
);

alter table public.sandbox_servers enable row level security;

create policy "sandbox_servers_select_own" on public.sandbox_servers
  for select using (auth.uid() = user_id);

-- Inserts/updates/deletes happen server-side only (via the secret-role
-- client), same pattern as the sandboxes table itself.

drop trigger if exists sandbox_servers_set_updated_at on public.sandbox_servers;
create trigger sandbox_servers_set_updated_at
  before update on public.sandbox_servers
  for each row execute function public.set_updated_at();

create index if not exists sandbox_servers_sandbox_id_idx on public.sandbox_servers (sandbox_id);
