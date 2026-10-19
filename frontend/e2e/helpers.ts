import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { request, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://localhost:3000';

// Same key and shape as src/lib/api/settings.ts.
const SETTINGS_KEY = 'payments-console:settings';

// Playwright is always run from frontend/ (npm scripts), so paths are relative to it.
/** Reads API_KEY from backend/.env at run time. It is never printed, logged or written anywhere. */
export function readApiKey(): string {
  const env = readFileSync(resolve(process.cwd(), '../backend/.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('API_KEY='));
  const key = line?.slice('API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (!key) throw new Error('API_KEY not found in backend/.env');
  return key;
}

/** Puts the key in sessionStorage before the app loads, exactly where the Settings dialog would. */
export async function signIn(page: Page): Promise<void> {
  const apiKey = readApiKey();
  await page.addInitScript(
    ([storageKey, value]) => sessionStorage.setItem(storageKey, value),
    [SETTINGS_KEY, JSON.stringify({ apiUrl: '/api', apiKey })],
  );
}

export async function apiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: API, extraHTTPHeaders: { 'X-API-Key': readApiKey() } });
}

export interface GatewayConfig {
  minLatencyMs: number;
  maxLatencyMs: number;
  failureRate: number;
  declineRate: number;
  timeoutRate: number;
}

export async function getGateway(ctx: APIRequestContext): Promise<GatewayConfig> {
  const res = await ctx.get('/gateway/config');
  if (!res.ok()) throw new Error(`GET /gateway/config failed: ${res.status()}`);
  return (await res.json()) as GatewayConfig;
}

export async function putGateway(ctx: APIRequestContext, cfg: GatewayConfig): Promise<void> {
  const res = await ctx.put('/gateway/config', { data: cfg });
  if (!res.ok()) throw new Error(`PUT /gateway/config failed: ${res.status()}`);
}
