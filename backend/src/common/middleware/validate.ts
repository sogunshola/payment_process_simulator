import { NextFunction, Request, Response } from 'express';
import { plainToInstance, ClassConstructor } from 'class-transformer';
import { validate as classValidate, ValidationError } from 'class-validator';
import { BadRequestError, ValidationDetail } from '../errors';

type Source = 'body' | 'query' | 'params';

function flatten(errors: ValidationError[], prefix = ''): ValidationDetail[] {
  return errors.flatMap((e) => {
    const field = prefix ? `${prefix}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validate<T extends object>(dto: ClassConstructor<T>, source: Source) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Only undefined means "nothing sent"; null is a real (invalid) JSON value.
    const raw: unknown = req[source] === undefined ? {} : req[source];
    if (!isPlainObject(raw)) {
      throw new BadRequestError(`Request ${source} must be a JSON object`);
    }

    const instance = plainToInstance(dto, raw, {
      // Query/params are always strings, so they need conversion. The body must
      // stay strict so that "100" never silently becomes a money amount.
      enableImplicitConversion: source !== 'body',
      exposeDefaultValues: true,
    });

    const errors = await classValidate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestError('Validation failed', flatten(errors));
    }

    // Express 5 makes req.query a getter that cannot be reassigned, so validated
    // data lives in one place for all sources instead of overwriting req.*.
    req.validated = { ...req.validated, [source]: instance };
    next();
  };
}
