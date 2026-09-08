import { z } from 'zod';

export const startServerSchema = z.object({
  /** If omitted, the repo directory is served as static files on the given port. */
  command: z.string().trim().min(1).max(2000).optional(),
  port: z.coerce.number().int().min(1).max(65535),
});

export const serverPortParamSchema = z.object({
  id: z.string().uuid(),
  port: z.coerce.number().int().min(1).max(65535),
});

export type StartServerInput = z.infer<typeof startServerSchema>;
