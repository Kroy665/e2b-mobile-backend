import { SupabaseClient } from '@supabase/supabase-js';
import { Logger } from 'pino';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      log?: Logger;
      user?: {
        id: string;
        email?: string;
        role?: string;
      };
      accessToken?: string;
      supabase?: SupabaseClient;
    }
  }
}

export {};
