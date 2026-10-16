import { Request, Response } from 'express';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { validate } from './validate';
import { BadRequestError } from '../errors';

class Customer {
  @IsEmail() email!: string;
}

class CreateDto {
  @IsInt() @Min(1) amount!: number;
  @IsString() currency!: string;
}

class NestedDto {
  @ValidateNested() @Type(() => Customer) customer!: Customer;
}

class QueryDto {
  @IsInt() page!: number;
}

class ParamsDto {
  @IsString() id!: string;
}

async function run(dto: new () => object, source: 'body' | 'query' | 'params', value: unknown) {
  const req = { [source]: value } as unknown as Request;
  const next = jest.fn();
  let error: unknown;
  try {
    await validate(dto, source)(req, {} as Response, next);
  } catch (e) {
    error = e;
  }
  return { req, next, error: error as BadRequestError | undefined };
}

describe('validate', () => {
  it('accepts a valid body and stores it on req.validated.body', async () => {
    const { req, next, error } = await run(CreateDto, 'body', { amount: 100, currency: 'USD' });
    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(req.validated?.body).toBeInstanceOf(CreateDto);
    expect(req.validated?.body).toMatchObject({ amount: 100, currency: 'USD' });
  });

  it('does not mutate the original source', async () => {
    const body = { amount: 1, currency: 'USD' };
    const { req } = await run(CreateDto, 'body', body);
    expect(req.body).toBe(body);
  });

  it('reports a missing required field', async () => {
    const { error, next } = await run(CreateDto, 'body', { amount: 5 });
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error?.details).toEqual([{ field: 'currency', message: expect.stringContaining('currency') }]);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unknown fields', async () => {
    const { error } = await run(CreateDto, 'body', { amount: 5, currency: 'USD', admin: true });
    expect(error?.details).toEqual([{ field: 'admin', message: expect.stringContaining('admin') }]);
  });

  it('does not coerce a string body value into a number', async () => {
    const { error } = await run(CreateDto, 'body', { amount: '100', currency: 'USD' });
    const details = error?.details as { field: string; message: string }[];
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((d) => d.field === 'amount')).toBe(true);
    expect(details.map((d) => d.message)).toContain('amount must be an integer number');
  });

  it('coerces query strings', async () => {
    const { req, error } = await run(QueryDto, 'query', { page: '5' });
    expect(error).toBeUndefined();
    expect(req.validated?.query).toMatchObject({ page: 5 });
  });

  it('still rejects a non-numeric query value', async () => {
    const { error } = await run(QueryDto, 'query', { page: 'abc' });
    expect(error?.details).toEqual([{ field: 'page', message: expect.any(String) }]);
  });

  it('uses dotted paths for nested errors', async () => {
    const { error } = await run(NestedDto, 'body', { customer: { email: 'nope' } });
    expect(error?.details).toEqual([{ field: 'customer.email', message: expect.any(String) }]);
  });

  it('rejects an array body', async () => {
    const { error } = await run(CreateDto, 'body', [1, 2]);
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error?.message).toBe('Request body must be a JSON object');
  });

  it('rejects a null body', async () => {
    const { error } = await run(CreateDto, 'body', null);
    expect(error?.message).toBe('Request body must be a JSON object');
  });

  it('treats an undefined body as an empty object', async () => {
    const { error } = await run(CreateDto, 'body', undefined);
    expect(error?.message).toBe('Validation failed');
    expect((error?.details as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('validates params', async () => {
    const ok = await run(ParamsDto, 'params', { id: 'abc' });
    expect(ok.req.validated?.params).toMatchObject({ id: 'abc' });
    const bad = await run(ParamsDto, 'params', {});
    expect(bad.error).toBeInstanceOf(BadRequestError);
  });
});
