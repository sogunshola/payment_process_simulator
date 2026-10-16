import { createHash, timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../errors';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export function createApiKeyAuth(expectedKey: string) {
  // Hashed once at startup. timingSafeEqual throws on buffers of different lengths, and
  // checking the lengths ourselves first would leak the key length through timing. Both
  // digests are always 32 bytes, so the comparison is constant-time whatever the input.
  const expectedDigest = sha256(expectedKey);

  return (req: Request, _res: Response, next: NextFunction): void => {
    // Node normally joins a repeated header into one string (which then fails the compare),
    // but the type allows an array; a repeated key header is never legitimate, so reject it.
    const provided: unknown = req.headers['x-api-key'];
    if (provided === undefined) throw new UnauthorizedError('Missing API key');
    if (typeof provided !== 'string' || !timingSafeEqual(sha256(provided), expectedDigest)) {
      throw new UnauthorizedError('Invalid API key');
    }
    next();
  };
}
