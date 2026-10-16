import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

interface Spec {
  openapi: string;
  security: unknown[];
  paths: Record<string, Record<string, { security?: unknown[] }>>;
  components: { securitySchemes: Record<string, unknown> };
}

const spec = parse(fs.readFileSync(path.resolve(__dirname, '../../docs/openapi.yaml'), 'utf8')) as Spec;

const ROUTES: Array<[string, string]> = [
  ['/health', 'get'],
  ['/payments', 'post'],
  ['/payments', 'get'],
  ['/payments/stats', 'get'],
  ['/payments/{id}', 'get'],
  ['/payments/{id}/status', 'patch'],
  ['/gateway/config', 'get'],
  ['/gateway/config', 'put'],
];

describe('docs/openapi.yaml', () => {
  it('is OpenAPI 3.0.x', () => {
    expect(spec.openapi).toMatch(/^3\.0\./);
  });

  it.each(ROUTES)('documents %s %s', (route, method) => {
    expect(spec.paths[route]?.[method]).toBeDefined();
  });

  it('documents exactly the listed routes', () => {
    const documented = Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => [p, m]));
    expect(documented.sort()).toEqual([...ROUTES].sort());
  });

  it('requires the API key globally except on /health', () => {
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth');
    expect(spec.security).toEqual([{ ApiKeyAuth: [] }]);
    expect(spec.paths['/health'].get.security).toEqual([]);
  });
});
