import { Request, Response } from 'express';
import { NotFoundError } from '../errors';

export function notFound(req: Request, _res: Response): never {
  throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
}
