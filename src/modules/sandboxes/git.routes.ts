import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { sandboxIdParamSchema } from './sandboxes.schemas';
import { gitCommitSchema, gitPushSchema } from './git.schemas';
import * as gitService from './git.service';

export const gitRouter = Router({ mergeParams: true });

gitRouter.get(
  '/status',
  validate({ params: sandboxIdParamSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await gitService.gitStatus(req.user.id, id);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

gitRouter.post(
  '/commit',
  validate({ params: sandboxIdParamSchema, body: gitCommitSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await gitService.gitCommit(req.user.id, id, req.body);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

gitRouter.post(
  '/push',
  validate({ params: sandboxIdParamSchema, body: gitPushSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params as unknown as { id: string };
    const result = await gitService.gitPush(req.user.id, id, req.body);
    res.status(StatusCodes.OK).json({ data: result });
  })
);
