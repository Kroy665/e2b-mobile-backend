-- Stores each user's AI provider API keys for use inside their E2B sandboxes
-- (e.g. running opencode with their own Anthropic/OpenAI key instead of the
-- shared free tier). Keys are encrypted at rest by the application layer
-- (AES-256-GCM, see src/lib/crypto.ts) before insert; this table never sees
-- plaintext keys.
create table if not exists public.ai_provider_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'openrouter', 'google')),
  api_key_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.ai_provider_keys enable row level security;

create policy "ai_provider_keys_select_own" on public.ai_provider_keys
  for select using (auth.uid() = user_id);

-- Inserts/updates/deletes happen server-side only (via the secret-role
-- client), so no write policy is granted to authenticated/anon roles.

drop trigger if exists ai_provider_keys_set_updated_at on public.ai_provider_keys;
create trigger ai_provider_keys_set_updated_at
  before update on public.ai_provider_keys
  for each row execute function public.set_updated_at();
