import request from 'supertest';
import { AppOptions } from '../src/app';

export const TEST_API_KEY = 'test-api-key-0123456789';

// Generous limits so only the rate-limit tests ever hit them.
export const appOptions: AppOptions = {
  apiKey: TEST_API_KEY,
  corsOrigins: ['http://localhost:5173'],
  rateLimit: { windowMs: 60_000, max: 100_000, createMax: 100_000 },
};

/** supertest agent that sends the test API key on every request. */
export const authed = (app: Parameters<typeof request>[0]) => request.agent(app).set('X-API-Key', TEST_API_KEY);
