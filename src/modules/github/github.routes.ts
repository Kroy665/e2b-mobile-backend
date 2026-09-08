import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { env } from '../../config/env';
import { oauthCallbackQuerySchema } from './github.schemas';
import * as githubService from './github.service';

export const githubRouter = Router();

/** Starts the OAuth flow: returns the GitHub authorize URL for the client to open. */
githubRouter.post(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const url = await githubService.createAuthorizeUrl(req.user.id);
    res.status(StatusCodes.OK).json({ data: { url } });
  })
);

/**
 * OAuth callback GitHub redirects to. No bearer token is available here (GitHub
 * is the caller), so the user is identified via the signed `state` value instead.
 */
githubRouter.get(
  '/callback',
  validate({ query: oauthCallbackQuerySchema }),
  asyncHandler(async (req, res) => {
    const { code, state } = req.query as unknown as { code: string; state: string };
    await githubService.handleOAuthCallback(code, state);
    res.redirect(`${env.APP_URL}/settings/integrations?github=connected`);
  })
);

githubRouter.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const status = await githubService.getConnectionStatus(req.user.id);
    res.status(StatusCodes.OK).json({ data: status });
  })
);

githubRouter.delete(
  '/disconnect',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    await githubService.disconnectGithub(req.user.id);
    res.status(StatusCodes.OK).json({ data: { message: 'GitHub disconnected' } });
  })
);

githubRouter.get(
  '/repos',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) throw ApiError.unauthorized();
    const repos = await githubService.listUserRepos(req.user.id);
    res.status(StatusCodes.OK).json({ data: repos });
  })
);
