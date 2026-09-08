import { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../../lib/errors';
import { UpdateProfileInput } from './users.schemas';

export async function getProfile(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();

  if (error) {
    throw ApiError.notFound('Profile not found');
  }
  return data;
}

export async function updateProfile(client: SupabaseClient, userId: string, input: UpdateProfileInput) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.fullName !== undefined) patch.full_name = input.fullName;
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
  if (input.bio !== undefined) patch.bio = input.bio;

  const { data, error } = await client.from('profiles').update(patch).eq('id', userId).select().single();

  if (error) {
    throw ApiError.internal('Failed to update profile', error.message);
  }
  return data;
}
