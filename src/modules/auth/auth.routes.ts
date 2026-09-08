import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { authRateLimiter } from '../../middleware/rateLimit';
import { requireAuth } from '../../middleware/auth';
import { forgotPasswordSchema, loginSchema, refreshSchema, signupSchema } from './auth.schemas';
import * as authService from './auth.service';
import { ApiError } from '../../lib/errors';

export const authRouter = Router();

authRouter.post(
  '/signup',
  authRateLimiter,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.signup(req.body);
    res.status(StatusCodes.CREATED).json({ data: result });
  })
);

authRouter.post(
  '/login',
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const result = await authService.refreshSession(req.body.refreshToken);
    res.status(StatusCodes.OK).json({ data: result });
  })
);

authRouter.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    await authService.requestPasswordReset(req.body.email);
    res.status(StatusCodes.OK).json({ data: { message: 'If the account exists, a reset email has been sent.' } });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.accessToken) throw ApiError.unauthorized();
    await authService.logout(req.accessToken);
    res.status(StatusCodes.OK).json({ data: { message: 'Logged out' } });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(StatusCodes.OK).json({ data: req.user });
  })
);
