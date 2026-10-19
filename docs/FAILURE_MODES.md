# Failure Modes

Every failure point found so far, how it is handled, and the automated test that proves it. Test paths are relative to `backend/`; the quoted text is the exact test name (a `%s` is a parameterised case). Anything without an automated test is listed honestly in the second section, not in the table.

All HTTP errors share one JSON shape: `{ statusCode, error, message, details, path, requestId, timestamp }`.

| Failure point | What happens | How it is handled | Test that proves it |
| --- | --- | --- | --- |
| Invalid request body (missing/blank/too-long `reference`, float/zero/negative/string/over-limit `amount`, bad `currency`, bad `customerEmail`) | Request cannot be a valid payment | 400 "Validation failed" with `details: [{field, message}]`; body values are not coerced, so `"100"` is not a number | `test/payments.e2e.spec.ts` › "rejects %s with 400" |
| Unknown field in a body | Mass-assignment / typos | `forbidNonWhitelisted` rejects it with 400 naming the field | `src/common/middleware/validate.spec.ts` › "rejects unknown fields"; `test/gateway.e2e.spec.ts` › "PUT rejects an unknown field" |
| Invalid UUID in the path | Would reach the database with garbage | 400 from the params DTO, before any query | `test/payments.e2e.spec.ts` › "400 for a non-UUID id" |
| Query bounds (`limit` > 100, `page` 0, non-numeric or fractional, unknown `status`) | Unbounded or nonsensical list queries | 400 from the query DTO (`@Type(() => Number)` is explicit because tsx emits no decorator metadata) | `test/payments.e2e.spec.ts` › "rejects ?%s with 400" |
| Invalid `Idempotency-Key` header (spaces, empty, > 255 chars, other characters) | Key is stored and indexed, so it must be bounded | 400 "Invalid Idempotency-Key header" | `test/payments.e2e.spec.ts` › "rejects Idempotency-Key %j with 400" |
| Client asks for status PROCESSING | Only the processor may claim work | 400 "status PROCESSING is reserved for the payment processor" | `test/payments.e2e.spec.ts` › "400 when asking for PROCESSING" |
| Malformed JSON | Parser throws | 400 "Malformed JSON in request body" | `test/app.e2e.spec.ts` › "returns 400 for malformed JSON" |
| Oversized body (> 10kb) | Memory/CPU abuse | 413 "Request body too large" in the shared shape; a body just under the limit still reaches validation | `test/security.e2e.spec.ts` › "413 for a body over 10kb, in the shared shape"; `test/security.e2e.spec.ts` › "does not 413 a body just under 10kb (it reaches validation instead)" |
| Payment not found | Unknown id | 404 `Payment <id> not found` | `test/payments.e2e.spec.ts` › "404 for an unknown id" |
| Duplicate request (client retries a POST with the same `Idempotency-Key`) | Would create a second payment | 200 with the original payment and `Idempotent-Replayed: true`; no second row | `test/payments.e2e.spec.ts` › "replays an identical request with the same key" |
| Same key reused with a different body | Wrong payment would be returned silently | 409 "Idempotency-Key has already been used with a different request" | `test/payments.e2e.spec.ts` › "returns 409 when the key is reused with a different body" |
| Concurrent POSTs with the same key pass the lookup together | Both would insert | Unique index lets one insert win; the loser catches `DuplicateIdempotencyKeyError`, re-reads and replays the winner (409 if its body differs) | `src/modules/payments/payments.service.spec.ts` › "returns the winner when a concurrent insert wins the race"; `src/modules/payments/payments.service.spec.ts` › "rejects when the race winner had a different request" |
| Concurrent update / lost compare-and-set / stale version (including ABA: PENDING to PROCESSING to PENDING between read and write) | Last writer would overwrite newer state | Update is a CAS on `status` AND `version`; zero rows affected gives 409 against the fresh status | `src/modules/payments/payments.service.spec.ts` › "reports the fresh status when the compare-and-set is lost"; `test/payments.e2e.spec.ts` › "refuses a stale version and leaves the row untouched" |
| Illegal status transition (final states, same status, PENDING to SUCCEEDED, ...) | State machine violation | 409 naming both statuses, `details: { currentStatus, requestedStatus }` | `test/payments.e2e.spec.ts` › "409 for an illegal transition, naming both statuses"; `src/modules/payments/payment-status.spec.ts` › "covers all 25 pairs" |
| Gateway call hangs (timeout) | Tick would block | Processor aborts after `GATEWAY_TIMEOUT_MS` and treats it as transient | `src/modules/processing/payment-processor.spec.ts` › "aborts the signal passed to a gateway that respects it" |
| Gateway ignores the abort signal | Tick would hang forever and block the batch | Processor also races the call against its own timer; the orphaned call is abandoned, not cancelled | `src/modules/processing/payment-processor.spec.ts` › "gives up on a call that ignores the abort signal and schedules a retry" |
| Transient gateway error | Temporary outage | Attempt counted, payment back to PENDING with `nextAttemptAt` from exponential backoff with full jitter (cap 30s) | `src/modules/processing/payment-processor.spec.ts` › "schedules a retry after a transient failure and succeeds once due"; `src/modules/processing/payment-processor.spec.ts` › "is full jitter up to 1s * 2^attempts" |
| Retries exhausted | Payment would retry forever | FAILED with `failureReason` `max_attempts_exceeded` after `PROCESSOR_MAX_ATTEMPTS` | `src/modules/processing/payment-processor.spec.ts` › "fails with max_attempts_exceeded after the last allowed attempt" |
| Permanent decline | Retrying cannot help | FAILED with the gateway message; never retried | `src/modules/processing/payment-processor.spec.ts` › "fails a declined payment without retrying" |
| Duplicate charge request for one payment | Customer charged twice | Simulated gateway returns the cached final outcome (approval or decline) and logs it. Transient errors and timeouts are not cached, otherwise retries would replay the failure | `src/modules/gateway/simulated-gateway.spec.ts` › "returns the same transaction for a repeat after approval and logs the duplicate"; `src/modules/gateway/simulated-gateway.spec.ts` › "does not cache transient errors, so a retry can succeed" |
| Two processors claim the same payment | Double processing | Claim is a CAS PENDING to PROCESSING; the loser skips it. better-sqlite3 is synchronous, so interleaving inside one statement is not exercised | `src/modules/processing/payment-processor.spec.ts` › "charges each payment once when two processors race over the same database" |
| Crash mid-processing (payment stuck in PROCESSING) | Payment would never finish | `recoverStuck()` runs at startup before listening and returns PROCESSING rows to PENDING without counting an attempt | `src/modules/processing/payment-processor.spec.ts` › "returns PROCESSING payments to PENDING without counting an attempt, then completes them" |
| Shutdown during processing | In-flight payments cut off | `stop()` stops scheduling and waits for the current tick; after `stopTimeoutMs` it gives up and the payment stays PROCESSING for recovery on next start | `src/modules/processing/payment-processor.spec.ts` › "waits for in-flight work before resolving"; `src/modules/processing/payment-processor.spec.ts` › "gives up after stopTimeoutMs and leaves the payment PROCESSING" |
| PATCH changes a PROCESSING payment while the gateway call is in flight | Two writers | The processor's outcome write is a CAS and is discarded with a warning; the API change wins. The gateway may already have charged, so a charge can exist without a SUCCEEDED record (no reconciliation) | `src/modules/processing/payment-processor.spec.ts` › "discards its result when the payment was changed by someone else mid-flight" |
| Database down at `/health` | Health must not report ok | 503 "Database unavailable"; driver message dropped | `test/app.e2e.spec.ts` › "GET /health returns 503 when the database is gone" |
| Repository error in the middle of processing a payment | One bad row must not stop the worker | Logged with the payment id; other payments in the batch finish; `processDue` never rejects; the payment may stay PROCESSING until next start | `src/modules/processing/payment-processor.spec.ts` › "logs a repository failure mid-payment without rejecting, and finishes the other payments"; `src/modules/processing/payment-processor.spec.ts` › "does not reject when loading due payments fails" |
| Unknown error or non-Error thrown | Internals could leak | 500 "Internal server error"; no stack or message in the body; full error logged server-side | `src/common/middleware/error-handler.spec.ts` › "maps unknown errors to a generic 500 and logs the error server-side"; `src/common/middleware/error-handler.spec.ts` › "maps a thrown non-Error value to 500" |
| Other database error | SQL text could leak | 500 generic | `src/common/middleware/error-handler.spec.ts` › "maps other QueryFailedError to 500" |
| Unique-constraint violation | Raw driver error | 409 "Resource already exists"; no SQL returned (real better-sqlite3 error code) | `test/app.e2e.spec.ts` › "maps a real unique-constraint violation to 409" |
| Headers already sent when an error occurs | Cannot write JSON any more | Handler delegates to `next(err)` so Express closes the connection | `src/common/middleware/error-handler.spec.ts` › "delegates to next when headers were already sent" |
| Rate abuse: too many requests overall | Resource exhaustion, API-key brute force | Global limiter per client IP, mounted before auth: 429 in the shared shape with `RateLimit`, `RateLimit-Policy` and `Retry-After` headers | `test/security.e2e.spec.ts` › "global limiter: the request over the limit gets 429 in the shared shape with RateLimit headers"; `test/security.e2e.spec.ts` › "global limiter runs before auth, so wrong keys are limited too" |
| Rate abuse: payment creation flood | Row flood in the database | Stricter limiter on `POST /payments` only; reads keep working | `test/security.e2e.spec.ts` › "create limiter: POST /payments hits 429 while GET /payments still works" |
| Missing or wrong API key (including different length, empty, repeated header) | Unauthenticated access | 401 "Missing API key" / "Invalid API key"; digests compared with `timingSafeEqual`, so length is not leaked; key never echoed | `test/security.e2e.spec.ts` › "401 without a key, in the shared error shape"; `test/security.e2e.spec.ts` › "401 with a wrong key of the same length"; `test/security.e2e.spec.ts` › "401 with a key of a different length %j"; `test/security.e2e.spec.ts` › "401 when the header is sent twice, even if both copies are correct"; `test/security.e2e.spec.ts` › "does not echo the key in the 401 body" |
| Unknown route without a key | Route enumeration | Routes sit behind auth, so the answer is 401, not 404; with a key it is a normal 404 | `test/security.e2e.spec.ts` › "answers 401 for an unknown route without a key, 404 with one" |
| Unknown CORS origin | Another website calling the API from a browser | No `Access-Control-Allow-Origin` header, so the browser blocks the response; not an error for non-browser callers | `test/security.e2e.spec.ts` › "sends no Access-Control-Allow-Origin for an unknown origin (and does not fail the request)"; `test/security.e2e.spec.ts` › "gives a preflight from an unknown origin no allow headers" |
| Secrets or PII in logs (API key header, `customerEmail`, SQL parameters of a failed query) | Credentials/PII in log storage | pino `redact` paths plus an `err` serializer that drops `query` and `parameters` | `src/common/logger.spec.ts` › "redacts customerEmail at every depth we guard"; `src/common/logger.spec.ts` › "redacts the x-api-key and authorization request headers"; `src/common/logger.spec.ts` › "drops SQL and bound parameters from a logged database error" |
| Invalid environment / configuration | Misconfigured service | `loadConfig` throws listing every invalid var, never the API key value; `server.ts` exits 1 | `src/config/env.spec.ts` › "lists every problem at once and never prints the API key" |
| Production boot with the placeholder API key (or none) | Publicly known secret in production | `loadConfig` refuses it without printing it; a missing key fails in every environment | `src/config/env.spec.ts` › "refuses the placeholder API_KEY without printing it"; `src/config/env.spec.ts` › "refuses a missing API_KEY"; `src/config/env.spec.ts` › "keeps .env.example in sync with the placeholder constant" |
| Untrusted `X-Request-Id` | Header/log injection | Accepted only if it matches `^[A-Za-z0-9._-]{1,128}$`, else replaced by a UUID | `src/common/middleware/request-id.spec.ts` › "replaces an invalid id (%s)"; `test/app.e2e.spec.ts` › "replaces an unsafe X-Request-Id" |
| Invalid gateway config via `PUT /gateway/config` (rate outside 0-1, latency out of range, missing/unknown field, min > max, rates summing > 1) | Chaos switch set to nonsense | 400 in the standard validation shape; nothing is applied | `test/gateway.e2e.spec.ts` › "PUT rejects %s with 400 and names the field" |
| Timestamps depend on the host time zone | Ambiguous times | Stored and returned as UTC (`Z` suffix) | `test/payments.e2e.spec.ts` › "returns timestamps as UTC ISO strings regardless of the process time zone" |

## Not covered by automated tests

These were either checked by hand once or not checked at all.

- **Startup: port already in use.** `server.ts` logs fatal and exits 1 on the server `error` event. Checked by hand earlier; no test.
- **Startup: database initialisation failure.** Fatal log, exit 1. No test.
- **`server.ts` shutdown ordering and the 20s force-exit.** SIGTERM/SIGINT order (stop processor, close server, close DB, exit 0) was checked by hand; the force-exit timer and the second-signal guard have no test. `processor.stop()` itself is tested.
- **Process-level `unhandledRejection` / `uncaughtException`.** Log fatal and exit 1. No test.
- **Wiring of `recoverStuck()` at startup.** `recoverStuck()` is tested; that `server.ts` calls it before listening is not.
- **PATCH during PROCESSING after a gateway charge.** The discarded write is tested, but nothing reconciles the charge that may already exist at the gateway. Known limitation.
- **Gateway state is lost on restart.** The simulated gateway keeps its idempotency record in memory (and unbounded), so a payment recovered after a restart could be charged twice in the simulation. A real gateway would honour idempotency keys across restarts.
- **Single-instance assumption.** `recoverStuck()` treats every PROCESSING row as abandoned and would steal live work from a second instance. A multi-instance design needs a lease column.
- **Rate-limit store is per process and keyed by IP.** Counts are not shared across instances, and behind a reverse proxy `trust proxy` must be configured or all clients share one bucket. Not tested.
- **Production mode has no migrations.** `synchronize` is off when `NODE_ENV=production`, so a fresh database has no tables and the service fails at startup (observed by hand: `no such table: payments`). Production is not runnable as-is.
- **A browser rendering `/docs`.** Swagger UI assets and the CSP were checked with curl only, not in a browser.
- **True interleaving at the database.** better-sqlite3 is synchronous, so the concurrency tests (same-key race, two processors) cannot interleave inside a single statement; the race branches are covered by mocked tests instead.

## Frontend

Test paths are relative to `frontend/`.

| Failure point | What happens | How it is handled | Test that proves it |
| --- | --- | --- | --- |
| Non-JSON error body (e.g. a proxy 502 HTML page, empty body) | `res.json()` would throw and hide the real failure | The client reads text, parses defensively, and `toApiError` falls back to a generic message per status | `src/lib/api/api-error.test.ts` › "falls back to a generic message for a non-JSON body (status %i)"; `src/lib/api/api-error.test.ts` › "maps a proxy HTML error page to a generic ApiError" |
| Network failure (backend down, DNS, CORS block) | `fetch` rejects with no status | Becomes `ApiError` with status 0 and "Cannot reach the API" | `src/lib/api/api-error.test.ts` › "turns a rejected fetch into ApiError status 0" |
| Malformed error JSON (message not a string, bad `details` entries, array or primitive body) | Mapping code could throw or show garbage | `toApiError` never throws: bad message falls back, bad detail entries are skipped | `src/lib/api/api-error.test.ts` › "falls back when message is not a string"; "skips malformed detail entries and ignores a non-string requestId"; "never throws on arrays or primitives" |
| Several validation messages for one field, or `details` as an object | Only one message would show, or the conflict info would be lost | Messages are joined per field; object details are kept raw with empty `fieldErrors` | `src/lib/api/api-error.test.ts` › "joins several messages for the same field"; "keeps an object details as-is with no field errors" |
| Create retried or repeated | Could replay or duplicate a payment | A fresh `Idempotency-Key` per create call; mutation retries are off | `src/lib/api/api-error.test.ts` › "sends a fresh UUID Idempotency-Key per create" |
| API key sent where it is not needed | Key exposed needlessly | `/health` is called without the key | `src/lib/api/api-error.test.ts` › "does not send the API key to /health" |
| Rate-limit pressure from polling (backend: 300 req/min per IP) | Own polling could trigger 429s | Health polls every 5s; live queries pause in background tabs; 4xx are never retried | Untested (configuration only, no automated test) |

## Frontend: not covered by automated tests

- **401 from a bad key shows "Unauthorized".** The `ApiError` 401 mapping and key header are tested, but the `ConnectionIndicator` component itself is not rendered in any test. Checked by reading the code only.
- **`sessionStorage` unavailable.** `getSettings` and `saveSettings` wrap access in try/catch and fall back to memory. Not tested.
- **Polling and rate limit.** The 5s health interval and paused background polling are untested; no load test against the backend limiter.
- **Dialog behaviour** (focus trap, Escape, focus restore) and the toast live region are untested.
- **API key in `sessionStorage` is readable by any XSS.** Accepted risk for a demo; the key is never put in a URL or logged.

## Arena (Chaos Arena game)

Test paths are relative to `frontend/`.

| Failure point | What happens | How it is handled | Test that proves it |
| --- | --- | --- | --- |
| `POST /payments` rate limit (30/min per IP) returns 429 | Intake would be rejected; retrying would make it worse | Base spawn interval is 2.5 s (24/min). On 429 the spawn is skipped, the interval doubles for 10 s, and "Intake throttled by API (429)" is logged. No immediate retry | `src/features/arena/game.test.ts` › "on a 429 logs it, skips the spawn and doubles the interval, without retrying at once" |
| Cancel races the processor (`PATCH` returns 409) | The payment left PENDING before the cancel landed | Logged as "too late, processor grabbed it", not an error toast; the other cancels in the batch still go through (`Promise.allSettled`) | `src/features/arena/game.test.ts` › "logs a 409 on cancel as "too late"" |
| Cancel power with nothing doomed | A wasted cooldown | Logs "No doomed payments", no request, no cooldown | `src/features/arena/game.test.ts` › "does not use the cancel power or start a cooldown when nothing is doomed" |
| Snapshot `GET /gateway/config` fails at start | Starting anyway could leave a chaos config with no way back | The run does not start; error toast and log; no PUT is sent | `src/features/arena/Arena.test.tsx` › "does not start, and changes nothing, when the snapshot GET fails" |
| Player leaves the route mid-run | Backend keeps the chaos config for everyone | Unmount restores the snapshot with a PUT | `src/features/arena/Arena.test.tsx` › "restores the snapshot when the route is left" |
| Tab closed or reloaded mid-run | Same | `pagehide` sends a `keepalive` PUT of the snapshot | `src/features/arena/Arena.test.tsx` › "sends a keepalive PUT with the snapshot on pagehide" |
| Tab killed hard, or the unload PUT is lost | Backend keeps the chaos config | The snapshot stays in `sessionStorage`; the next Arena mount in that tab restores it and logs it | `src/features/arena/Arena.test.tsx` › "restores a stale snapshot left in sessionStorage on mount" |
| Reset while chaos is active | Backend keeps the chaos config | Reset restores the snapshot and the banner disappears | `src/features/arena/Arena.test.tsx` › "shows the chaos banner while a run is active and restores on reset" |
| Round timing: pause, resume, stop | Rounds could fire during a pause or after stop | Remaining time is kept on pause; stop cancels the timer | `src/features/arena/rounds.test.ts` (pause/resume, stop, order, compressed duration) |
| Coin missing from the newest-100 list | Its state would be lost | The last known state is kept; a run creates at most ~90 payments so this should not happen | `src/features/arena/engine.test.ts` › "keeps the last known state of a tracked id missing from the response" |
| SLA breach, combo and star rules | Wrong scoring or an unfair early end | Pure functions, covered by edge cases (warming up, window of 20, 10 s continuous, recovery) | `src/features/arena/scoring.test.ts` |

### Arena: not covered by automated tests

- **Absolute API URL makes the keepalive PUT cross-origin.** Browsers may refuse a keepalive request that needs a CORS preflight, so the unload restore may not be sent. Only the default same-origin `/api` proxy is expected to work. The stale snapshot is the fallback. Untested.
- **The global gateway config affects every client and tab during a run.** Another operator sees the chaos config. Not tested; only the warning banner addresses it.
- **Two Arena tabs at once.** Each holds its own snapshot; the second may snapshot the first one's chaos config and "restore" to it. Untested and not handled.
- **Backend restart loses the gateway config (in memory).** The snapshot restore still applies on the next visit, but a restart mid-run is not tested.
- **Coins beyond the newest 100** are not tracked by design (see above); no test with more than 100 payments.
- **Failover, Slow intake and round-start-during-failover interplay** (failover end reapplies the current round, pause cancels it) have no automated test.
- **Auto-demo script** is not tested; only checked by reading the code. About 30 s means some coins are still in flight at the end.
- **Canvas drawing, `devicePixelRatio`, `ResizeObserver` and reduced motion in the renderer.** jsdom has no 2D context. Only the pure movement step (`stepCoins`, including the reduced-motion snap) is tested.
- **401 during a run** resets the run with a toast. Untested.
- **Best scores in `localStorage`** (corrupt or blocked storage) are guarded by try/catch but untested.
- **Polling stops at run end**, so coins in flight when a run ends stop updating their status on screen.

