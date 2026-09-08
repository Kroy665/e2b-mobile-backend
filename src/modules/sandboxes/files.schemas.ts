import { z } from 'zod';

export const listFilesQuerySchema = z.object({
  path: z.string().trim().max(1000).default('.'),
});

export const fileContentQuerySchema = z.object({
  path: z.string().trim().min(1).max(1000),
});

export const writeFileSchema = z.object({
  path: z.string().trim().min(1).max(1000),
  content: z.string().max(2_000_000),
});

export const deleteFileQuerySchema = z.object({
  path: z.string().trim().min(1).max(1000),
});

export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;
export type FileContentQuery = z.infer<typeof fileContentQuerySchema>;
export type WriteFileInput = z.infer<typeof writeFileSchema>;
export type DeleteFileQuery = z.infer<typeof deleteFileQuerySchema>;
