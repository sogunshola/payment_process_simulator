# Payment Processing Simulation

A Node.js microservice that simulates payment processing, with a React frontend to follow. The backend is Express 5 + TypeScript (strict) + TypeORM on SQLite.

## Backend

Prerequisite: Node.js >= 20.

```bash
cd backend
npm install
cp .env.example .env   # then set API_KEY (min 16 chars) to your own secret
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run with auto-reload (tsx) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run lint` | ESLint (type-checked rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit and e2e tests |
| `npm run test:cov` | Tests with coverage |

Configuration is read only from validated environment variables (see `backend/.env.example`); the service refuses to start if any are invalid.

TypeORM `synchronize` is on outside production for convenience. Production would use migrations instead.

## Payments API

Endpoints are not yet authenticated (API key auth comes later). Amounts are integers in minor units (e.g. kobo/cents); currencies are `NGN`, `USD`, `EUR`, `GBP`.

| Method and path | Success | Errors |
| --- | --- | --- |
| `POST /payments` | 202 + `Location: /payments/<id>`; 200 + `Idempotent-Replayed: true` on replay | 400 validation or bad `Idempotency-Key`; 409 key reused with a different body |
| `GET /payments?status=&page=&limit=` | 200 `{ data, page, limit, total }` (newest first, `limit` max 100, default 20) | 400 invalid query |
| `GET /payments/stats` | 200 count per status plus `total` | |
| `GET /payments/:id` | 200 | 400 not a UUID; 404 |
| `PATCH /payments/:id/status` body `{ status, reason? }` | 200 updated payment | 400 invalid status or `PROCESSING` (reserved for the processor); 404; 409 illegal transition |

Statuses: `PENDING -> PROCESSING | CANCELLED`, `PROCESSING -> SUCCEEDED | FAILED | PENDING (retry)`. `SUCCEEDED`, `FAILED` and `CANCELLED` are final.

Idempotency: send an optional `Idempotency-Key` header (`[A-Za-z0-9_.:-]`, 1-255 chars) on `POST /payments`. Repeating the same request with the same key returns the original payment (200) instead of creating another; the same key with a different body returns 409.

## Background processing

A background processor in the same process picks up `PENDING` payments and charges them through a simulated gateway.

- **Lifecycle:** every `PROCESSOR_POLL_INTERVAL_MS` the processor loads up to `PROCESSOR_BATCH_SIZE` due payments, claims each with a compare-and-set (`PENDING -> PROCESSING`), calls the gateway, then writes `SUCCEEDED`, `FAILED`, or back to `PENDING` for a retry. Ticks never overlap.
- **Retries:** transient gateway errors and timeouts are retried with exponential backoff and full jitter (random delay up to `min(30s, 1s * 2^attempts)`) until `PROCESSOR_MAX_ATTEMPTS`, then the payment fails with `max_attempts_exceeded`. A decline is final and not retried.
- **Timeout:** a gateway call is aborted after `GATEWAY_TIMEOUT_MS` and counted as a transient failure, even if the gateway ignores the abort signal.
- **Recovery:** on startup, before listening, any payment left in `PROCESSING` by a crash is returned to `PENDING` (without counting an attempt). On SIGTERM the processor waits up to 10s for in-flight payments; any left over are recovered on the next start.
- **Single instance only:** recovery assumes every `PROCESSING` payment is abandoned, so running two instances would steal live work. A multi-instance design would need a lease column.
- **Gateway chaos endpoint:** `GET /gateway/config` and `PUT /gateway/config` (full replace) read and change the simulated gateway's latency and failure rates at runtime, e.g. `{"minLatencyMs":0,"maxLatencyMs":10,"failureRate":0,"declineRate":1,"timeoutRate":0}` declines every payment. It is unauthenticated until API-key auth lands.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GATEWAY_MIN_LATENCY_MS` / `GATEWAY_MAX_LATENCY_MS` | 100 / 800 | Simulated latency range (0-10000, min <= max) |
| `GATEWAY_FAILURE_RATE` | 0.2 | Chance of a transient error |
| `GATEWAY_DECLINE_RATE` | 0.1 | Chance of a decline |
| `GATEWAY_TIMEOUT_RATE` | 0.05 | Chance the call hangs until aborted (the three rates must sum to <= 1) |
| `GATEWAY_TIMEOUT_MS` | 5000 | How long the processor waits for one gateway call |
| `PROCESSOR_POLL_INTERVAL_MS` | 1000 | Time between ticks |
| `PROCESSOR_BATCH_SIZE` | 10 | Payments per tick |
| `PROCESSOR_MAX_ATTEMPTS` | 5 | Attempts before a payment fails |

## Layout and conventions

```
backend/src
  server.ts        startup, graceful shutdown, process-level handlers
  app.ts           Express app assembly (middleware order lives here)
  config/          env loading + validation
  database/        DataSource factory
  common/          logger, typed errors, shared middleware
  modules/<name>/  entity, dtos, repository, service, controller, routes, module
backend/test       end-to-end tests (supertest, in-memory SQLite)
```

Each module follows controller -> service -> repository. Only repositories touch TypeORM. The `<name>.module.ts` file wires dependencies by hand; there is no DI framework.

All errors go through one handler and share one JSON shape. See `docs/FAILURE_MODES.md` for every handled failure and how it is tested.
