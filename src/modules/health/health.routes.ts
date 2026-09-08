import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAdmin } from '../../lib/supabase';

export const healthRouter = Router();

/**
 * TEMPORARY diagnostic endpoint for the intermittent RLS bug (see
 * TESTING.md). Remove once root-caused. Never guarded by auth — do not leave
 * deployed longer than needed for this investigation.
 */
healthRouter.get(
  '/__debug/rls',
  asyncHandler(async (_req, res) => {
    const roleCheck = await supabaseAdmin.rpc('debug_role_check');

    const testInsert = await supabaseAdmin
      .from('oauth_states')
      .insert({
        state: `debug-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        user_id: '554d77e0-64f8-4738-b56b-d15fee96ce34',
        provider: 'github',
      })
      .select();

    if (testInsert.data?.[0]) {
      await supabaseAdmin.from('oauth_states').delete().eq('state', testInsert.data[0].state);
    }

    res.status(StatusCodes.OK).json({
      uptime: process.uptime(),
      roleCheck: { data: roleCheck.data, error: roleCheck.error },
      testInsert: { data: testInsert.data, error: testInsert.error },
      env: {
        secretKeyPrefix: process.env.SUPABASE_SECRET_KEY?.slice(0, 12),
        secretKeyLength: process.env.SUPABASE_SECRET_KEY?.length,
        supabaseUrl: process.env.SUPABASE_URL,
      },
    });
  })
);

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
