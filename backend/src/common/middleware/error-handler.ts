import { STATUS_CODES } from 'node:http';
import { NextFunction, Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppError } from '../errors';

interface Resolved {
  statusCode: number;
  message: string;
  details: unknown;
}

const UNIQUE_CODES = new Set(['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY']);

// body-parser errors are http-errors objects carrying `type`, `status` and `expose`.
function asHttpError(err: unknown): { type?: unknown; status?: unknown; expose?: unknown } | null {
  return typeof err === 'object' && err !== null ? err : null;
}

function resolve(err: unknown): Resolved {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message, details: err.details };
  }

  const http = asHttpError(err);
  if (http?.type === 'entity.parse.failed') {
    return { statusCode: 400, message: 'Malformed JSON in request body', details: null };
  }
  if (http?.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request body too large', details: null };
  }
  if (
    http?.expose === true &&
    typeof http.status === 'number' &&
    http.status >= 400 &&
    http.status < 500
  ) {
    // Generic text only: the library's own message is not ours to vouch for.
    return { statusCode: http.status, message: STATUS_CODES[http.status] ?? 'Bad request', details: null };
  }

  if (err instanceof QueryFailedError) {
    const code = (err.driverError as { code?: string } | undefined)?.code;
    if (code !== undefined && UNIQUE_CODES.has(code)) {
      return { statusCode: 409, message: 'Resource already exists', details: null };
    }
  }

  return { statusCode: 500, message: 'Internal server error', details: null };
}

// Express recognises error middleware by its 4-argument signature.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // Too late to send JSON; let Express close the connection.
    return next(err);
  }

  const { statusCode, message, details } = resolve(err);

  if (statusCode >= 500) {
    // Full error (with stack) goes to server logs only, never to the client.
    req.log?.error({ err }, 'Unhandled error');
  }

  res.status(statusCode).json({
    statusCode,
    error: STATUS_CODES[statusCode],
    message,
    details,
    // Query string stripped: it may carry sensitive data.
    path: req.originalUrl.split('?')[0],
    requestId: req.id,
    timestamp: new Date().toISOString(),
  });
}
