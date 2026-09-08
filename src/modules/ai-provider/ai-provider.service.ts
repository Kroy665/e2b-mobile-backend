import { ApiError } from '../../lib/errors';
import { decrypt, encrypt } from '../../lib/crypto';
import { supabaseAdmin } from '../../lib/supabase';
import { PROVIDER_ENV_VAR, Provider } from './ai-provider.schemas';

export async function setProviderKey(userId: string, provider: Provider, apiKey: string) {
  const { error } = await supabaseAdmin.from('ai_provider_keys').upsert(
    {
      user_id: userId,
      provider,
      api_key_encrypted: encrypt(apiKey),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  if (error) {
    throw ApiError.internal('Failed to store provider key', error.message);
  }
}

export async function listProviders(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('provider, created_at, updated_at')
    .eq('user_id', userId);

  if (error) {
    throw ApiError.internal('Failed to list provider keys', error.message);
  }
  return data;
}

export async function deleteProviderKey(userId: string, provider: Provider) {
  const { error } = await supabaseAdmin
    .from('ai_provider_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);

  if (error) {
    throw ApiError.internal('Failed to remove provider key', error.message);
  }
}

/**
 * Returns env vars to inject into a sandbox for every provider key the user
 * has configured (e.g. { ANTHROPIC_API_KEY: '...' }). Never log or return
 * this value to clients.
 */
export async function getProviderEnvVars(userId: string): Promise<Record<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('ai_provider_keys')
    .select('provider, api_key_encrypted')
    .eq('user_id', userId);

  if (error) {
    throw ApiError.internal('Failed to load provider keys', error.message);
  }

  const envVars: Record<string, string> = {};
  for (const row of data ?? []) {
    const envVar = PROVIDER_ENV_VAR[row.provider as Provider];
    if (envVar) {
      envVars[envVar] = decrypt(row.api_key_encrypted);
    }
  }
  return envVars;
}
