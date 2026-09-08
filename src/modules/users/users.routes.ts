import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../lib/errors';
import { updateProfileSchema } from './users.schemas';
import * as usersService from './users.service';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) throw ApiError.unauthorized();
    const profile = await usersService.getProfile(req.supabase, req.user.id);
    res.status(StatusCodes.OK).json({ data: profile });
  })
);

usersRouter.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user || !req.supabase) throw ApiError.unauthorized();
    const profile = await usersService.updateProfile(req.supabase, req.user.id, req.body);
    res.status(StatusCodes.OK).json({ data: profile });
  })
);
