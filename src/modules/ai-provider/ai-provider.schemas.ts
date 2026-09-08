import { z } from 'zod';

export const PROVIDERS = ['anthropic', 'openai', 'openrouter', 'google'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_ENV_VAR: Record<Provider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
};

export const setProviderKeySchema = z.object({
  provider: z.enum(PROVIDERS),
  apiKey: z.string().trim().min(1).max(500),
});

export const providerParamSchema = z.object({
  provider: z.enum(PROVIDERS),
});

export type SetProviderKeyInput = z.infer<typeof setProviderKeySchema>;
