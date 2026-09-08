import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { filesRouter } from './files.routes';
import { gitRouter } from './git.routes';
import { createSandboxSchema, runOpencodeSchema, sandboxIdParamSchema } from './sandboxes.schemas';
import * as sandboxesService from './sandboxes.service';

export const sandboxesRouter = Router();

sandboxesRouter.use(requireAuth);
sandboxesRouter.use('/:id/files', filesRouter);
sandboxesRouter.use('/:id/git', gitRouter);

sandboxesRouter.post(
  '/',
  validate({ body: createSandboxSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const result = await sandboxesService.createSandboxWithRepo(req.user.id, req.body);
    res.status(StatusCodes.CREATED).json({ data: result });
  })
);

sandboxesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const result = await sandboxesService.listSandboxes(req.user.id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

sandboxesRouter.get(
  '/:id',
  validate({ params: sandboxIdParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await sandboxesService.getSandbox(req.user.id, id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

sandboxesRouter.delete(
  '/:id',
  validate({ params: sandboxIdParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await sandboxesService.terminateSandbox(req.user.id, id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

/**
 * Pauses (not terminates) the sandbox — preserves its filesystem/memory state
 * so opencode's session history and any uncommitted changes survive. It
 * resumes automatically the next time it's used (opencode run, terminal connect).
 */
sandboxesRouter.post(
  '/:id/pause',
  validate({ params: sandboxIdParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await sandboxesService.pauseSandbox(req.user.id, id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

sandboxesRouter.post(
  '/:id/opencode',
  validate({ params: sandboxIdParamSchema, body: runOpencodeSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await sandboxesService.runOpencode(req.user.id, id, req.body);
    res.status(StatusCodes.OK).json({ data: result });
  })
);
