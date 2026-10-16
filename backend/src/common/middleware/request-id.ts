import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

// Strict allow-list: the id is echoed in a response header and written to logs,
// so anything else (newlines, spaces) could enable header/log injection.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming !== undefined && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
