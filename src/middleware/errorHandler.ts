import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';
import { isProduction } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = res.getHeader('X-Request-Id');

  if (err instanceof ZodError) {
    req.log?.warn({ err }, 'Validation error');
    return res.status(StatusCodes.BAD_REQUEST).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.flatten(),
        requestId,
      },
    });
  }

  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      req.log?.error({ err }, err.message);
    } else {
      req.log?.warn({ err }, err.message);
    }
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId,
      },
    });
  }

  req.log?.error({ err }, 'Unhandled error');
  return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : (err as Error)?.message ?? 'Unknown error',
      requestId,
    },
  });
}
