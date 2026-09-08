import compression from 'compression';
import cors from 'cors';
import express, { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalRateLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { aiProviderRouter } from './modules/ai-provider/ai-provider.routes';
import { authRouter } from './modules/auth/auth.routes';
import { githubRouter } from './modules/github/github.routes';
import { healthRouter } from './modules/health/health.routes';
import { sandboxesRouter } from './modules/sandboxes/sandboxes.routes';
import { usersRouter } from './modules/users/users.routes';

const allowedOrigins = env.CORS_ORIGINS === '*' ? '*' : env.CORS_ORIGINS.split(',').map((o) => o.trim());

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId ?? '',
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(globalRateLimiter);

  app.use('/', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/integrations/github', githubRouter);
  app.use('/api/v1/integrations/ai-provider', aiProviderRouter);
  app.use('/api/v1/sandboxes', sandboxesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
