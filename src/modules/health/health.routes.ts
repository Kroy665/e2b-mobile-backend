import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../lib/supabase';

export const healthRouter = Router();

healthRouter.get('/healthz', (_req, res) => {
  res.status(StatusCodes.OK).json({ status: 'ok', uptime: process.uptime() });
});

/** Readiness check: verifies the app can actually reach its dependencies (Supabase). */
healthRouter.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
    if (error) {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
        status: 'error',
        dependencies: { supabase: 'unreachable' },
      });
    }
    return res.status(StatusCodes.OK).json({
      status: 'ok',
      dependencies: { supabase: 'ok' },
    });
  })
);
