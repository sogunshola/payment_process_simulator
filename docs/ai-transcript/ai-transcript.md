# AI transcript

A curated record of the prompts I gave the AI assistant (Claude Code) and a summary of each response. Only the prompts that shaped the delivered code are included.

**How to read this**

- Prompts are verbatim. Response summaries are condensed from the assistant's final report for each turn, so they describe what it claimed. They are not independent proof. What was actually verified and what was left untested is in [FAILURE_MODES.md](../FAILURE_MODES.md), and what I changed or rejected is in [REVIEW_LOG.md](../REVIEW_LOG.md).
- Working pattern: the session model planned and reviewed. A Sonnet subagent wrote the code. The session model re-ran lint, typecheck/build and tests itself before reporting.
- Nothing was committed by the assistant. Each turn ended with a proposed Conventional Commits message for me to review.

**Left out on purpose**

- A first attempt (npm workspaces, `apps/api`, Zod, JSON-file repository, RFC 7807 errors). It built a scaffold, a pure domain layer and a repository layer before I restarted with the stack in CLAUDE.md (Express 5, TypeORM, SQLite). None of that code is in this repo.
- Housekeeping turns such as "have the agents completed it?", a pasted prompt that got cut off mid-sentence and had to be re-sent (the hardening prompt, #5), and the assistant's progress updates.

| # | Step | Commit |
|---|---|---|
| 1 | Repo rules and scaffolding | `d194c45` |
| 2 | Backend scaffold | `6466169` |
| 3 | Payments module | `d12792a` |
| 4 | Gateway and background processor | `6de61ad` |
| 5 | Security hardening and docs | `012f9e8` |
| 6 | Frontend foundation | `f55ebfa` |
| 7 | Chaos Arena | `6ff7b3c` |
| 8 | Frontend polish | `e04b1c2` |
| 9 | Server-generated references | `e04b1c2` |
| 10 | BullMQ migration | `e04b1c2` |

Steps 8–10 were committed together in `e04b1c2`.

---

## 1. Repo rules and scaffolding

**Prompt**

> You are my pair-programmer on a take-home assessment: a Node.js payment-processing simulation microservice plus a React frontend. It is graded on ownership, failure handling, background processing, security, code quality and completeness. Keep everything simple and boring: no abstraction without a clear need.
>
> Before writing application code, do only this:
> 1. Initialise git (main branch) and add a .gitignore (node_modules, dist, .env, *.sqlite, coverage).
> 2. Create CLAUDE.md at the repo root with these standing rules:
>    - Workflow for every task: (a) plan first: list files to touch and risks; (b) implement in small steps; (c) comment non-obvious logic, explaining WHY; (d) write custom test cases including failure and edge cases; (e) run lint, build and tests and show real output; (f) finish with a descriptive conventional-commit message and wait for my review. Do not run git commit yourself.
>    - Stack: Express 5 (NOT NestJS), TypeScript strict, TypeORM with SQLite (better-sqlite3), class-validator and class-transformer for DTOs, Jest and supertest. Frontend later: Vite, React, TypeScript.
>    - Architecture: feature modules in the style of NestJS, but plain Express. Each module folder holds its entity, DTOs, repository, service, controller, routes and a module file that wires them together by hand. Layers are controller, service, repository; services never use TypeORM directly. No DI framework.
>    - Money is an integer in minor units, never a float. Timestamps are UTC. IDs are UUIDs.
>    - Errors: typed AppError subclasses, one global error-handling middleware, a single JSON error shape, never leak stack traces.
>    - Config only through validated env. Never commit secrets.
>    - Every failure point you find goes into docs/FAILURE_MODES.md with the test that proves it.
>    - Be honest about anything untested.
> 3. Create docs/REVIEW_LOG.md with a table: Prompt | What AI produced | What I changed or rejected | Why.
> 4. Create docs/ai-transcript/.gitkeep.
>
> Do not scaffold the app yet. Show me CLAUDE.md when done.

**Response summary**

- Initialised `main`, `.gitignore`, `CLAUDE.md`, the REVIEW_LOG template and `docs/ai-transcript/.gitkeep`. No app code.
- Added a few things beyond the brief and flagged them for removal: example `AppError` subclass names, fail-fast on invalid config, a `.env.example` rule, and constructor-passed dependencies.
- Wrote these files directly instead of delegating, since they are config and docs rather than application code.

---

## 2. Backend scaffold

**Prompt**

> Plan first, then scaffold /backend with Express 5, TypeScript strict, TypeORM with SQLite (better-sqlite3), class-validator, class-transformer, reflect-metadata, dotenv, pino and pino-http. This is plain Express, not NestJS, but organised into NestJS-style feature modules.
>
> Layout under backend/src:
> - server.ts: boots the database, creates the app, listens, and handles SIGTERM and SIGINT (stop accepting connections, close the database, exit).
> - app.ts: createApp(modules) builds the Express app: request id, logging, JSON body parser, each module's router, then the 404 and error middleware.
> - config/: validated env (PORT, DB_PATH, API_KEY, CORS_ORIGINS, NODE_ENV). Fail fast with a clear message when it is invalid.
> - database/data-source.ts: a TypeORM DataSource with synchronize on for development (the README should say production would use migrations).
> - common/errors: an AppError base class plus BadRequestError, UnauthorizedError, NotFoundError and ConflictError.
> - common/middleware: requestId, validate, notFound, errorHandler.
> - modules/health: health.module.ts exports the router for GET /health, which pings the database. Empty folders for payments, gateway and processing come later.
>
> Module convention: every module has a *.module.ts exporting createXModule(dataSource) that builds its repository, service and controller by hand and returns { router }. No DI framework.
>
> Validation: validate(DtoClass, 'body' | 'query' | 'params') middleware using plainToInstance and class-validator with whitelist and forbidNonWhitelisted. Failures throw a BadRequestError whose details are a list of {field, message}.
>
> Error handler: ONE JSON shape for every error: statusCode, error, message, details, path, requestId, timestamp. Map AppError subclasses, malformed JSON (400), oversized body (413), TypeORM unique-constraint errors (409), and anything unknown to a generic 500 with no internals, logging the stack on the server only. Express 5 forwards async errors automatically, so handlers need no try/catch wrappers.
>
> Request id: use X-Request-Id when present and sane, otherwise generate one, return it in the response header, and include it in every log line.
>
> Tests: unit tests for each branch of the error handler and the validate middleware; supertest smoke tests for /health, a JSON 404 for an unknown route, and a 400 for malformed JSON. Run lint, build and tests. Add run steps to the README.

**Response summary**

- Built by a Sonnet subagent and re-checked by the session model: lint, typecheck and build clean, 57 tests in 5 suites passing.
- One error handler with one JSON shape. Stack traces and internals go to server logs only. The 409 for unique violations is tested against a real SQLite constraint.
- The request body is never type-coerced, so `"100"` cannot silently become a money amount. Query and path params are coerced.
- Shutdown guards against a second signal, closes idle keep-alive connections, and force-exits after 10s. The Express 5 `listen` callback quirk (it logs "listening" even when the port is taken) was handled.
- Version pins were chosen to avoid peer conflicts (TypeORM 0.3, TypeScript 5.9, `@types/node` 22).
- **Flagged risk:** `tsx` does not emit the type metadata TypeORM uses to infer column types, so `npm run dev` could pick wrong column types once tables exist. Recommended an explicit `type` on every column.
- **Untested (documented):** bad-config exit, port-in-use, SIGTERM/SIGINT, the 10s force-exit and the process-level crash handlers were checked by hand only.

---

## 3. Payments module

**Prompt**

> Build the payments module at backend/src/modules/payments using standard layering: controller to service to repository.
>
> Files: payment.entity.ts, payment-status.ts (enum, allowed-transitions map, canTransition helper), dto/create-payment.dto.ts, dto/update-status.dto.ts, dto/list-payments.query.ts, payments.repository.ts, payments.service.ts, payments.controller.ts, payments.routes.ts, and payments.module.ts (createPaymentsModule(dataSource) wires repository, service and controller by hand and returns the router).
>
> Entity Payment (TypeORM decorators): id (uuid), reference, amount (integer minor units), currency (NGN, USD, EUR, GBP), description (optional), customerEmail (optional), status (PENDING, PROCESSING, SUCCEEDED, FAILED, CANCELLED), failureReason (optional), attempts (default 0), nextAttemptAt (optional), idempotencyKey (unique, nullable), history (simple-json list of {status, at, note}), createdAt, updatedAt.
>
> PaymentsRepository wraps dataSource.getRepository(Payment) and exposes: create, findById, findByIdempotencyKey, list(status, page, limit), countByStatus, and updateIfStatus(id, expectedStatus, changes), a compare-and-set built with the query builder (UPDATE ... WHERE id AND status = expected) that returns whether a row changed. This stops a request and the background processor from overwriting each other.
>
> Status rules: PENDING to PROCESSING or CANCELLED; PROCESSING to SUCCEEDED, FAILED or PENDING (retry); SUCCEEDED, FAILED and CANCELLED are final. Every change appends a history entry.
>
> Endpoints:
> - POST /payments: optional Idempotency-Key header (a repeated key returns the existing payment instead of creating another; if two requests race, catch the unique-constraint error and return the winner). Responds 202 with status PENDING.
> - GET /payments/:id (400 when the id is not a UUID, 404 if missing).
> - GET /payments with status filter, page and limit (max 100), and GET /payments/stats returning counts per status (register it before :id).
> - PATCH /payments/:id/status: legal transitions only. Moving to PROCESSING is reserved for the processor. Illegal transitions return 409 naming the current and requested status, and so does losing the compare-and-set.
>
> DTO validation with class-validator, through the validate middleware: amount integer 1 to 1,000,000,000; currency IsIn; reference 1 to 64 characters; description max 256; customerEmail IsEmail; status IsEnum. Throw NotFoundError and ConflictError from common/errors.
>
> Tests: unit tests for canTransition (every status pair) and for the service with a mocked repository. Integration tests with supertest against the real app on in-memory SQLite covering each endpoint, invalid bodies (missing field, float amount, negative, unknown field, bad currency, bad email), invalid UUID, 404, illegal transition 409, idempotent replay, and two parallel POSTs with one key creating exactly one payment. Record failure points in docs/FAILURE_MODES.md.

**Response summary**

- Every endpoint, status code and validation rule implemented. Lint, typecheck and build clean; 142 tests in 8 suites passing on the session model's own run.
- **Additions to the spec** that I did not object to: a `version` column in the compare-and-set (closes the ABA hole, where a payment returns to the same status after a retry and a stale writer still wins), and a 409 when an `Idempotency-Key` is reused with a different body.
- Idempotency race: the repository turns the database duplicate-key error into its own error type, so the service never touches TypeORM. The service returns the winning request after checking the body matches.
- `page` and `limit` use `@Type(() => Number)` rather than implicit conversion, since `tsx` does not emit the metadata implicit conversion needs.
- **Open points raised:** the 409 message after losing a race can name a legal transition; `version` and `idempotencyKey` appear in responses; `createdAt` has second precision while history has millisecond precision.
- **Untested (documented):** the same-key race end to end (the SQLite driver is synchronous, so requests may never overlap), concurrent PATCH over HTTP, and authentication (not built yet).

---

## 4. Gateway and background processor

**Prompt**

> Add asynchronous payment processing in two small modules under backend/src/modules.
>
> 1. gateway: SimulatedGateway.charge(paymentId, amount, currency, signal) resolves as approved or throws a GatewayError of type transient or declined. Behaviour comes from an in-memory config {minLatencyMs, maxLatencyMs, failureRate (transient errors), declineRate (permanent decline), timeoutRate (the call hangs until the abort signal fires)} with defaults from env. It remembers the result per paymentId, so charging the same payment twice returns the same result and never double charges; log when that happens. Add routes GET and PUT /gateway/config, validated with class-validator (rates 0 to 1, latency 0 to 10000), so the frontend can inject chaos.
>
> 2. processing: PaymentProcessor with start() and stop(). It runs a self-scheduling loop (wait 1 second after each tick finishes, so ticks never overlap). Each tick loads PENDING payments whose nextAttemptAt is empty or due (limit 10) and claims each with updateIfStatus(PENDING to PROCESSING), so a payment is never processed twice. Then call the gateway with a timeout (AbortController, default 5 seconds):
>    - approved: SUCCEEDED.
>    - declined: FAILED with the reason, no retry.
>    - transient error or timeout: attempts + 1, wait a random time between 0 and min(30s, 1s * 2^attempts) (jitter), set nextAttemptAt and return to PENDING; after MAX_ATTEMPTS (default 5) set FAILED with reason max_attempts_exceeded.
>    Never let an exception escape a tick: log it with the payment id and carry on.
>
> 3. Crash safety: on startup, processor.recoverStuck() moves any payment left in PROCESSING back to PENDING (document the single-instance assumption). On SIGTERM or SIGINT, server.ts calls processor.stop(), which waits for in-flight payments to finish (up to 10 seconds), then closes the HTTP server and the database before exiting.
>
> Tests (jest fake timers, fake gateway): success; decline is not retried; transient then success; retries exhausted; a hung call is aborted at the timeout; two processor instances never process the same payment; stuck PROCESSING recovered on startup; stop() waits for in-flight work; the gateway charges once when called twice for the same payment. Update docs/FAILURE_MODES.md.

**Response summary**

- Gateway and processor implemented; lint, typecheck and build clean, 205 tests in 12 suites passing.
- Every claim and result write goes through the version-checked update. If a payment changed during the gateway call (for example via PATCH), the processor logs a warning and drops its result instead of overwriting.
- Retry classification depends only on the gateway call. A database error while saving a result is logged and the payment waits in PROCESSING for recovery, so it cannot trigger a false retry.
- Timeouts both abort the call and race it against a timer, so a gateway that ignores the abort signal still cannot hang a tick. A late approval is remembered, so the next retry gets it back and does not charge twice.
- Live check by the subagent: 5 payments succeeded, `declineRate=1` sent the next payment to FAILED, SIGTERM exited 0.
- **Untested or limitations (documented):** server.ts startup/shutdown order is hand-checked only; two processors never truly overlap in tests; single instance only; the gateway cache is in memory and never cleared; a PATCH during PROCESSING discards the result but the gateway may already have charged.
- Recommended API-key auth as the next task, since `/gateway/config` was open to anyone.

---

## 5. Security hardening and docs

**Prompt**

> Harden and document the backend, still keeping it simple.
>
> - helmet; the cors package allowing only the origins in CORS_ORIGINS; express-rate-limit with a global limit and a stricter one on POST /payments; express.json with a 10kb limit (a 413 through the error handler).
> - An apiKeyAuth middleware that reads the X-API-Key header and compares it with crypto.timingSafeEqual (hash both values with sha256 first so the lengths match). Mount /health and /docs BEFORE it so they stay public; everything else sits behind it. Failures return 401 through the global error handler.
> - Never log the API key or customerEmail. Refuse to boot in production when API_KEY is missing or still the default.
> - Swagger: write docs/openapi.yaml by hand for every endpoint (request and response schemas, the X-API-Key scheme, the Idempotency-Key header and the shared error shape) and serve it with swagger-ui-express at /docs. Add a test that /docs loads.
> - Finish docs/FAILURE_MODES.md as one table: Failure point | What happens | How it is handled | Test that proves it. Cover at least invalid input, duplicate request, concurrent update, gateway timeout, transient gateway error, permanent decline, crash mid-processing, shutdown during processing, database error, rate abuse, oversized body. Every row must name a real test.
> - Write the root README: overview, quick start (install, env, run, test), environment variable table, API summary with curl examples, design decisions and trade-offs, known limitations (SQLite, one instance, in-process worker) and what I would change for production (Postgres, migrations, a real queue).
>
> Tests: 401 without or with a wrong key, 429 when rate limited, CORS rejects an unknown origin, security headers present, 413 on an oversized body, production boot refuses the default key. Report test coverage.

**Response summary**

- Lint, typecheck and build clean; 253 tests in 15 suites passing. Coverage: 97.4% statements, 89.1% branches, 98.5% functions, 98.0% lines.
- Middleware order: helmet and CORS first (so 401 and 429 also carry security headers and preflights are answered before auth), then rate limiting, then public `/health` and `/docs`, then API-key auth. The stricter limiter applies only to `POST /payments`. A repeated `X-API-Key` header is rejected.
- With `NODE_ENV=production` and the placeholder key, boot exits 1 without printing the key.
- Two catches by the subagent: a failed insert puts the SQL and parameters (including `customerEmail`) on the error, so a log serializer now strips them, with a test. A test also keeps `.env.example`'s placeholder key in sync with the one production refuses.
- FAILURE_MODES became one table, and a script checked that every test named in it exists.
- **Untested or limitations (documented):** Swagger UI was checked with curl only, never in a browser; production mode fails with `no such table: payments` because there are no migrations; 413 and malformed-JSON responses are returned without a key because the body parser runs before auth; rate limiting behind a proxy; startup and shutdown wiring.
- **Note:** the first send of this prompt was cut off mid-sentence. The assistant asked for the missing part rather than guessing, and I re-sent the full text above.

---

## 6. Frontend foundation

**Prompt**

> Create /frontend with Vite, React 18, TypeScript strict, Tailwind CSS, Framer Motion, React Router and TanStack Query. If a frontend-design skill is available, use it.
>
> Design direction: a refined dark fintech control-room look. One accent colour (electric mint), near-black background, subtle grid and glass cards, generous spacing. Inter for the UI and JetBrains Mono for ids and amounts. Put colours, radii and spacing in Tailwind theme tokens. Status colours: PENDING amber, PROCESSING blue with a gentle pulse, SUCCEEDED green, FAILED red, CANCELLED grey. Respect prefers-reduced-motion.
>
> Build only the primitives we need: Button, Card, StatusBadge, Input, Select, Modal, Drawer, Toast, Skeleton, EmptyState. Routes: / (Console) and /arena (Chaos Arena), each a placeholder with a polished top navigation and a small connection indicator.
>
> API layer: one small typed client with fetch. It sends X-API-Key, turns the backend error JSON into an ApiError (status, message, field errors), generates a UUID Idempotency-Key for every create call, and exposes TanStack Query hooks. Live updates are simple polling with refetchInterval of 1 second. A settings dialog stores API URL and key in sessionStorage. Configure the Vite dev proxy.
>
> Tests with Vitest and React Testing Library: ApiError mapping and StatusBadge. Run lint, typecheck and tests.

**Response summary**

- Lint, typecheck, tests (24 passing) and build clean on the session model's own run.
- Tailwind v4 with colours, radii and spacing as theme tokens. React 18.3 pinned.
- `ApiError` maps any non-JSON body (including a proxy's HTML 502) to a generic message, network failures to status 0, and backend field errors to a field-to-message map.
- Polling: 1s for live data, 5s for `/health`, paused when the tab is hidden. 4xx responses are not retried and create calls are never retried.
- Connection indicator shows Connected, Unauthorized (401), Offline or Checking, reusing the stats query so it adds no requests.
- **Noted behaviour:** a fresh Idempotency-Key on every create means a double-click would create two payments. The planned mitigation is disabling submit while a create is in flight.
- **Not checked:** the UI had not been opened in a browser. Untested items (Unauthorized state on screen, sessionStorage unavailable, dialog focus, polling pressure on the rate limit, API key readable by XSS in sessionStorage) went into FAILURE_MODES.

---

## 7. Chaos Arena

**Prompt**

> Build the /arena route: a game where the player is the on-call engineer keeping a payment pipeline alive. Everything must use the REAL API, with no mock mode.
>
> Core loop: coins (payments created through POST /payments at a spawn rate) travel left to right through the Gateway to a Success vault or a Failed pile. Coin colour follows live status from polling. A retried payment visibly bounces back and shows its attempt count. A scrolling engineer log lists what changed.
>
> Four rounds of about 45 seconds each raise the chaos through PUT /gateway/config: 1 Warm-up (latency spikes), 2 Flaky gateway (30 percent transient errors), 3 Timeout storm (timeouts), 4 Meltdown (high failure plus declines).
>
> Three player powers, each a real API call with a cooldown shown on the button:
> - Slow intake: lowers the spawn rate (client-side backpressure).
> - Failover: sets the gateway config to healthy for 8 seconds.
> - Cancel doomed: PATCH to CANCELLED on PENDING payments that already have 3 or more attempts.
>
> Scoring: points per success with a combo multiplier, a penalty per failure, and an SLA meter (success rate over the last 20 settled payments, target 90 percent). The run ends if the SLA stays under 60 percent for 10 seconds, or after round 4. Show an Incident Report card: score, stars, success rate, total retries absorbed, failures. Keep best scores in localStorage. Add an Auto-demo button that plays a scripted run so a reviewer can watch in 30 seconds, plus Start, Pause and Reset.
>
> Performance: draw on a canvas with requestAnimationFrame and keep per-frame state in refs so React does not re-render per coin. Always restore the default gateway config on Reset, on exit and on page unload, and show a banner while chaos is active.
>
> Tests: scoring and SLA as pure functions, the round scheduler with fake timers, and that leaving the page restores the gateway config.

**Response summary**

- Lint, typecheck, build and 61 tests (7 files) passing on the session model's own run.
- **Gateway restore, reviewed closely:** all gateway writes go through one queue, so a round's config cannot land after a restore. Start refuses to run if an earlier restore failed, so leftover chaos is never saved as the default. Restores happen on reset, pause, run end, route exit (unmount), tab close or reload (`pagehide` with a `keepalive` PUT) and on the next visit (stale snapshot in sessionStorage).
- Departures from the spec, stated by the assistant: coins freeze when the run ends because polling stops; a breached run can still earn 1–2 stars (3 stars needs all four rounds); combo multiplier is `min(1 + floor(streak/3), 5)`; Cancel doomed costs 25 points; pause also restores the gateway; spawn is paced at one coin per 2.5s to stay under the 30 per minute create limit, and a 429 doubles the interval for 10s.
- **Not run against the real backend or in a browser** at this point (no `backend/.env` existed). Untested items listed in FAILURE_MODES: canvas drawing, auto-demo, Failover and Slow intake, a 401 mid-run, corrupt localStorage, restore on tab close with an absolute API URL, two Arena tabs, backend restart mid-run, more than 100 payments.

---

## 8. Frontend polish

**Prompt**

> Polish the frontend without adding features.
>
> - Responsive layouts for phone, tablet and desktop; an ErrorBoundary with a friendly recovery screen; a banner when the backend is unreachable.
> - A first-run empty state in the Console with a Create your first payment action and one sentence explaining the Arena.
> - Accessibility: keyboard-only use of dialogs, the drawer and the Arena controls, visible focus rings, contrast checked for every status colour.
> - Performance: lazy-load the Arena route and report the bundle sizes.
> - Take screenshots of both routes into docs/media and reference them in the README.
> - Optional if time allows: one Playwright test that opens the Console, creates a payment and sees it reach SUCCEEDED.
>
> Run the full frontend test suite and report the real output.

**Response summary**

- Lint, typecheck, Vitest (139 tests in 14 files) and build clean on the session model's own run. Bundles: main 359.10 kB (gzip 116.09), Arena chunk 25.98 kB (gzip 9.00), CSS 26.42 kB (gzip 5.78).
- Playwright (the subagent's own run, not re-run by the session model): 10 passed, 1 skipped. Includes a payment reaching SUCCEEDED, backend field errors showing under the right input, and no horizontal scroll at 320, 375, 768 and 1280 px.
- Added ErrorBoundary, a backend-unreachable banner (a 401 gets a quieter hint), a first-run empty state, a responsive nav and Arena, focus trapping with Escape and focus return, labelled power-button cooldowns, a skip link, and four screenshots in `docs/media`.
- Every status colour measures at least 6:1 contrast, now asserted by a test. Form borders were about 1.2:1 and got a 3.5:1 token. Details are in `docs/ACCESSIBILITY.md`.
- **Went beyond "no new features":** the assistant added a New payment modal and a Recent payments list, because the Console had no create flow and the e2e test needed one. Amounts are parsed as strings, never as floats, and `1,000.50` is rejected because the comma is locale-ambiguous.
- **Not covered:** real screen-reader testing, Drawer and Settings dialog focus tests, a failed lazy-chunk load, and ghost/secondary button edge contrast below 3:1.
- Noticed that the backend gateway config was not at its defaults, likely because another tab was running a game, and told me how to reset it.

---

## 9. Server-generated payment references

**Prompt**

> in the backend flow, the reference is being generated and sent from the FE, let's ensure that the reference is generated from the BE and is unique

**Response summary**

- Lint, build and tests pass in both packages: 261 backend and 139 frontend tests.
- References are `PAY-` plus 12 random characters (Crockford base32 from `crypto.randomBytes`, about 60 bits).
- **Uniqueness comes from the database, not the randomness.** The `reference` column has a unique index. On a collision the service regenerates and retries, 3 attempts in total, then returns a generic 500.
- With two unique columns, the repository inspects the database error to tell a reference collision from an idempotency-key collision. The existing same-key race handling is unchanged.
- A client that sends `reference` now gets a 400. Replaying an idempotency key returns the original payment and reference. The field was removed from the create modal and the Arena.
- **Warning:** an existing dev database with duplicate references will fail to start when the unique index is added. Deleting `backend/payments.sqlite` fixes it.

---

## 10. BullMQ migration

**Prompt**

> Now everything seems good.
> one last thing, for the queuing and retry mechanism, let us move it to bullMQ with redis, let it handle all of that, so we can cut down on code volume and complexities

**Response summary**

- Lint, typecheck and tests clean on the session model's own run: 284 passed, 3 skipped. The 3 skipped are real-Redis integration tests (`REDIS_INTEGRATION=1`); the subagent ran them against live Redis and all 3 passed.
- **It did not cut code volume.** The processing folder went from 714 to 887 lines (775 without the integration test). The processor shrank from 285 to 227 lines, but a BullMQ wrapper, a Redis reachability check, boot-time reconciliation and shutdown timeouts replaced it. What went away is the hard-to-get-right code: the polling loop, stop/drain logic, `recoverStuck()` and `findDue`. BullMQ now handles scheduling, attempt counting, backoff, concurrency and worker-crash recovery, and one job per payment (`jobId = paymentId`) makes running two instances safe.
- **Kept in application code on purpose:** version-checked writes (the API can still change a payment mid-job), the gateway timeout (BullMQ has none per job), declines being final, and jittered backoff as a custom BullMQ strategy so `nextAttemptAt` matches the real retry time.
- **Beyond the brief:** an explicit `ioredis` dependency (BullMQ 6 needs it); `/health` returns 200 with `redis: "down"` rather than 503, because the frontend treats any 5xx as "backend unreachable"; shutdown timeouts, added after shutdown hung with Redis down; and startup reconciliation also re-enqueues PROCESSING rows, so a Redis queue loss cannot strand them.
- **Known gap (documented):** a payment set back to PENDING while its job is on its last attempt stays PENDING until the next boot.
- **Not covered by automated tests:** Redis dying while running, BullMQ's own crash detection, Redis persistence, two instances at once, and the `server.ts` startup/shutdown code. The subagent checked the first two by hand, including killing a worker mid-job and restarting.
- New env vars `REDIS_URL` and `PROCESSOR_CONCURRENCY`; Redis starts via `docker compose up -d redis`. The assistant offered a smaller variant (BullMQ's built-in exponential backoff, no shutdown timeouts) that would lose the exact `nextAttemptAt` and the hang protection.
