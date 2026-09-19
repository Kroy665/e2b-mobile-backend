import { z } from 'zod';

export const createSandboxSchema = z.object({
  repoUrl: z
    .string()
    .url()
    .refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url), {
      message: 'repoUrl must be an https://github.com/<owner>/<repo> URL',
    }),
  branch: z.string().trim().min(1).max(200).optional(),
});

export const sandboxIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const opencodeSessionParamSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().trim().regex(/^ses_[a-zA-Z0-9]+$/, 'sessionId must be a valid opencode session id (ses_...)'),
});

export const runOpencodeSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  model: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]+\/[a-z0-9_.-]+$/i, 'model must be in <provider>/<model-id> format')
    .optional(),
  /** Continue an existing opencode session (from a previous run's response) instead of starting fresh. */
  sessionId: z
    .string()
    .trim()
    .regex(/^ses_[a-zA-Z0-9]+$/, 'sessionId must be a valid opencode session id (ses_...)')
    .optional(),
});

export type CreateSandboxInput = z.infer<typeof createSandboxSchema>;
export type RunOpencodeInput = z.infer<typeof runOpencodeSchema>;
