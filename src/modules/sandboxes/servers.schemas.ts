import { z } from 'zod';

export const startServerSchema = z.object({
  command: z.string().trim().min(1).max(2000),
  port: z.coerce.number().int().min(1).max(65535),
});

export const serverPortParamSchema = z.object({
  id: z.string().uuid(),
  port: z.coerce.number().int().min(1).max(65535),
});

export type StartServerInput = z.infer<typeof startServerSchema>;
