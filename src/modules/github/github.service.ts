import { randomBytes } from 'crypto';
import { env } from '../../config/env';
import { ApiError } from '../../lib/errors';
import { decrypt, encrypt } from '../../lib/crypto';
import { supabaseAdmin } from '../../lib/supabase';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const OAUTH_SCOPES = ['repo', 'read:user'];

interface GithubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
}

/** Creates a one-time state bound to the user, then returns the GitHub authorize URL. */
export async function createAuthorizeUrl(userId: string): Promise<string> {
  const state = randomBytes(24).toString('hex');

  const { error } = await supabaseAdmin.from('oauth_states').insert({
    state,
    user_id: userId,
    provider: 'github',
  });
  if (error) {
    throw ApiError.internal('Failed to initiate GitHub connection', error.message);
  }

  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GITHUB_OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

/** Resolves a callback `state` to the user id that initiated it, consuming the state (single use). */
async function consumeState(state: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('oauth_states')
    .select('user_id, expires_at')
    .eq('state', state)
    .single();

  if (error || !data) {
    throw ApiError.badRequest('Invalid or expired OAuth state');
  }

  await supabaseAdmin.from('oauth_states').delete().eq('state', state);

  if (new Date(data.expires_at).getTime() < Date.now()) {
    throw ApiError.badRequest('OAuth state has expired, please reconnect');
  }

  return data.user_id as string;
}

async function exchangeCodeForToken(code: string): Promise<GithubTokenResponse> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
    }),
  });

  const data = (await res.json()) as GithubTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw ApiError.badRequest('GitHub token exchange failed', data.error_description ?? data.error);
  }
  return data;
}

async function fetchGithubUser(accessToken: string): Promise<GithubUserResponse> {
  const res = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw ApiError.internal('Failed to fetch GitHub user profile');
  }
  return (await res.json()) as GithubUserResponse;
}

/** Handles the OAuth callback: exchanges the code, fetches the GitHub identity, and stores the encrypted token. */
export async function handleOAuthCallback(code: string, state: string): Promise<{ userId: string; login: string }> {
  const userId = await consumeState(state);
  const tokenResponse = await exchangeCodeForToken(code);
  const githubUser = await fetchGithubUser(tokenResponse.access_token as string);

  const tokenExpiresAt = tokenResponse.expires_in
    ? new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from('github_connections').upsert(
    {
      user_id: userId,
      github_user_id: githubUser.id,
      github_login: githubUser.login,
      access_token_encrypted: encrypt(tokenResponse.access_token as string),
      refresh_token_encrypted: tokenResponse.refresh_token ? encrypt(tokenResponse.refresh_token) : null,
      scope: tokenResponse.scope ?? null,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    throw ApiError.internal('Failed to store GitHub connection', error.message);
  }

  return { userId, login: githubUser.login };
}

export async function getConnectionStatus(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('github_connections')
    .select('github_login, scope, created_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw ApiError.internal('Failed to fetch GitHub connection status', error.message);
  }

  return data ? { connected: true, login: data.github_login, scope: data.scope } : { connected: false };
}

export async function disconnectGithub(userId: string) {
  const { error } = await supabaseAdmin.from('github_connections').delete().eq('user_id', userId);
  if (error) {
    throw ApiError.internal('Failed to disconnect GitHub', error.message);
  }
}

/** Returns the decrypted access token for a user, or throws if not connected. Never log or return this value to clients. */
export async function getDecryptedAccessToken(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('github_connections')
    .select('access_token_encrypted')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw ApiError.badRequest('GitHub account is not connected');
  }

  return decrypt(data.access_token_encrypted);
}

export async function listUserRepos(userId: string) {
  const accessToken = await getDecryptedAccessToken(userId);

  const res = await fetch(`${GITHUB_API_URL}/user/repos?per_page=100&sort=updated`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    throw ApiError.internal('Failed to fetch repositories from GitHub');
  }

  const repos = (await res.json()) as Array<{
    id: number;
    full_name: string;
    private: boolean;
    clone_url: string;
    default_branch: string;
  }>;

  return repos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    private: r.private,
    cloneUrl: r.clone_url,
    defaultBranch: r.default_branch,
  }));
}
