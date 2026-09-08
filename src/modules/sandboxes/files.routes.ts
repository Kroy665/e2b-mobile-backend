import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { sandboxIdParamSchema } from './sandboxes.schemas';
import {
  deleteFileQuerySchema,
  fileContentQuerySchema,
  listFilesQuerySchema,
  writeFileSchema,
} from './files.schemas';
import * as filesService from './files.service';

export const filesRouter = Router({ mergeParams: true });

filesRouter.get(
  '/',
  validate({ params: sandboxIdParamSchema, query: listFilesQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const { path } = req.query as unknown as { path: string };
    const result = await filesService.listFiles(req.user.id, id, path);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

filesRouter.get(
  '/content',
  validate({ params: sandboxIdParamSchema, query: fileContentQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const { path } = req.query as unknown as { path: string };
    const result = await filesService.readFile(req.user.id, id, path);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

filesRouter.put(
  '/content',
  validate({ params: sandboxIdParamSchema, body: writeFileSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await filesService.writeFile(req.user.id, id, req.body.path, req.body.content);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

filesRouter.delete(
  '/content',
  validate({ params: sandboxIdParamSchema, query: deleteFileQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const { path } = req.query as unknown as { path: string };
    const result = await filesService.deleteFile(req.user.id, id, path);
    res.status(StatusCodes.OK).json({ data: result });
  })
);
