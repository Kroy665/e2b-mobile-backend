import { StatusCodes } from 'http-status-codes';

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(StatusCodes.BAD_REQUEST, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(StatusCodes.UNAUTHORIZED, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(StatusCodes.FORBIDDEN, 'FORBIDDEN', message);
  }

  static notFound(message = 'Resource not found', details?: unknown) {
    return new ApiError(StatusCodes.NOT_FOUND, 'NOT_FOUND', message, details);
  }

  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(StatusCodes.CONFLICT, 'CONFLICT', message, details);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error', details?: unknown) {
    return new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', message, details);
  }
}
