import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { ApiError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { oauthCallbackQuerySchema } from './github.schemas';
import * as githubService from './github.service';

function renderOAuthResultPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center;
    justify-content: center; min-height: 100vh; margin: 0; background: #f5f5f7; color: #1c1c1e; }
  main { text-align: center; padding: 32px; max-width: 360px; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { font-size: 15px; color: #6e6e73; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${message}</p>
</main>
</body>
</html>`;
}

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
 *
 * Renders a plain HTML result page rather than redirecting into a custom URL
 * scheme — works identically whether the client is Expo Go (which only owns
 * its own dynamic exp:// scheme, not the app's) or a standalone/dev-client
 * build. The mobile app re-checks GitHub connection status when its in-app
 * browser sheet is dismissed, so the user just taps back/done to return.
 */
githubRouter.get(
  '/callback',
  validate({ query: oauthCallbackQuerySchema }),
  asyncHandler(async (req, res) => {
    const { code, state } = req.query as unknown as { code: string; state: string };

    try {
      const { login } = await githubService.handleOAuthCallback(code, state);
      res
        .status(StatusCodes.OK)
        .type('html')
        .send(
          renderOAuthResultPage(
            'GitHub connected',
            `Connected as @${login}. You can close this and return to the app.`
          )
        );
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong connecting your GitHub account.';
      const sentence = message.endsWith('.') ? message : `${message}.`;
      res
        .status(StatusCodes.OK)
        .type('html')
        .send(renderOAuthResultPage('Connection failed', `${sentence} You can close this and return to the app.`));
    }
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
