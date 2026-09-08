import { supabaseAdmin } from '../../lib/supabase';
import { ApiError } from '../../lib/errors';
import { LoginInput, SignupInput } from './auth.schemas';

export async function signup({ email, password, fullName }: SignupInput) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : undefined,
  });

  if (error) {
    if (error.status === 422 || /already registered/i.test(error.message)) {
      throw ApiError.conflict('An account with this email already exists');
    }
    throw ApiError.internal('Failed to create account', error.message);
  }

  const userId = data.user?.id;
  if (userId) {
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: userId,
      email,
      full_name: fullName ?? null,
    });
    if (profileError) {
      throw ApiError.internal('Failed to create user profile', profileError.message);
    }
  }

  return { userId, email };
}

export async function login({ email, password }: LoginInput) {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });

  if (error) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  return {
    accessToken: data.session?.access_token,
    refreshToken: data.session?.refresh_token,
    expiresAt: data.session?.expires_at,
    user: {
      id: data.user?.id,
      email: data.user?.email,
    },
  };
}

export async function refreshSession(refreshToken: string) {
  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session) {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  };
}

export async function requestPasswordReset(email: string) {
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);
  if (error) {
    throw ApiError.internal('Failed to send password reset email', error.message);
  }
}

export async function logout(accessToken: string) {
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken);
  if (error) {
    throw ApiError.internal('Failed to log out', error.message);
  }
}
