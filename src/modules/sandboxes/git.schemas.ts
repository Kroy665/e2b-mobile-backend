import { z } from 'zod';

export const gitCommitSchema = z.object({
  message: z.string().trim().min(1).max(500),
});

export const gitPushSchema = z.object({
  branch: z.string().trim().min(1).max(200).optional(),
  setUpstream: z.boolean().optional(),
});

export type GitCommitInput = z.infer<typeof gitCommitSchema>;
export type GitPushInput = z.infer<typeof gitPushSchema>;
