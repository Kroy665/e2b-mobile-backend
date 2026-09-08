import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';
import { createUserScopedClient } from '../lib/supabase';

export interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  exp?: number;
}

const jwks = jwksClient({
  jwksUri: env.SUPABASE_JWKS_URL,
  cache: true,
  cacheMaxAge: 10 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getSigningKey(kid: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!kid) {
      reject(new Error('Token is missing a key id (kid)'));
      return;
    }
    jwks.getSigningKey(kid, (err, key) => {
      if (err || !key) {
        reject(err ?? new Error('Signing key not found'));
        return;
      }
      resolve(key.getPublicKey());
    });
  });
}

export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new Error('Malformed token');
  }

  const signingKey = await getSigningKey(decoded.header.kid);

  return jwt.verify(token, signingKey, {
    algorithms: ['RS256', 'ES256'],
  }) as SupabaseJwtPayload;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/** Verifies the Supabase JWT (via JWKS) and attaches req.user + req.supabase. Rejects if missing/invalid. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return next(ApiError.unauthorized('Missing bearer token'));
  }

  try {
    const payload = await verifySupabaseJwt(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.accessToken = token;
    req.supabase = createUserScopedClient(token);
    return next();
  } catch {
    return next(ApiError.unauthorized('Invalid or expired token'));
  }
}

/** Like requireAuth, but continues (without req.user) if no token is present or verification fails. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) return next();

  try {
    const payload = await verifySupabaseJwt(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.accessToken = token;
    req.supabase = createUserScopedClient(token);
  } catch {
    // ignore invalid token for optional auth
  }
  return next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!req.user.role || !roles.includes(req.user.role)) {
      return next(ApiError.forbidden('Insufficient permissions'));
    }
    return next();
  };
}
