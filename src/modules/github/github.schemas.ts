import { z } from 'zod';

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
