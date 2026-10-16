# Failure Modes

Each failure point implemented so far, how it is handled, and what proves it. "Untested" entries are listed honestly; the manual checks were run once by hand, not automated.

All HTTP errors use one shape: `{ statusCode, error, message, details, path, requestId, timestamp }`.

| Failure | Handling | Proven by |
| --- | --- | --- |
| Invalid or missing environment (e.g. no `API_KEY`, bad `PORT`) | `loadConfig` throws listing every invalid var (never the key value); `server.ts` prints it to stderr and exits 1 | `src/config/env.spec.ts` (loadConfig). The exit-1 path in `server.ts`: manual check (ran with `API_KEY` unset, exit code 1). Untested automatically |
| Database fails to initialise at startup | Fatal log, exit 1 | Untested |
| Port already in use | Server `error` event: fatal log, exit 1 | Manual check (EADDRINUSE logged, exit 1). Untested automatically |
| Malformed JSON body | 400 "Malformed JSON in request body" | `error-handler.spec.ts`; `test/app.e2e.spec.ts` |
| Oversized body (> 100kb) | 413 "Request body too large" | `error-handler.spec.ts`; `test/app.e2e.spec.ts` |
| Other client errors from the body parser (e.g. 415 unsupported charset) | Status kept, generic text from `http.STATUS_CODES`; library message not echoed | `error-handler.spec.ts` (including `expose: false` falling through to 500) |
| Request validation failure | 400 "Validation failed" with flat `details` of `{field, message}`, dotted paths for nested fields | `validate.spec.ts` |
| Unknown field in request | Rejected (`forbidNonWhitelisted`) with a 400 | `validate.spec.ts` |
| Non-object body, `"100"` sent as a number | Array/null rejected; body values are not coerced, so strings fail numeric checks | `validate.spec.ts` |
| Unique / primary-key constraint violation | 409 "Resource already exists"; no SQL or driver text returned | `error-handler.spec.ts`; `test/app.e2e.spec.ts` (real better-sqlite3 error) |
| Other database error | 500 generic; full error logged server-side | `error-handler.spec.ts` |
| Unknown error, or a non-Error value thrown | 500 "Internal server error"; stack and message never in the response; logged with `req.log` | `error-handler.spec.ts` |
| Headers already sent when an error occurs | Handler delegates to `next(err)` so Express closes the connection | `error-handler.spec.ts` |
| Database down at `/health` | 503 "Database unavailable" (driver message dropped) | `test/app.e2e.spec.ts` |
| Untrusted `X-Request-Id` | Accepted only if it matches `^[A-Za-z0-9._-]{1,128}$`, else replaced by a UUID (prevents header/log injection) | `request-id.spec.ts`; `test/app.e2e.spec.ts` |
| Unknown route | 404 in the standard shape | `test/app.e2e.spec.ts` |
| SIGTERM / SIGINT | Stop accepting connections, let in-flight requests finish, close DB, exit 0; second signal ignored; 10s force-exit with code 1 | Manual check (SIGTERM and SIGINT exited 0 with logs). Untested automatically; the 10s force-exit timer is untested |
| Unhandled rejection / uncaught exception | Fatal log, exit 1 (process state is unknown, so a supervisor should restart) | Untested |
| Invalid payment body (missing/blank/too-long `reference`, float/zero/negative/string/over-limit `amount`, bad `currency`, bad `customerEmail`, unknown field) | 400 "Validation failed" with `details` naming the field | `test/payments.e2e.spec.ts` (`POST /payments`, one case per input) |
| Invalid pagination (`limit` > 100, `page` 0, non-integer or non-numeric values, unknown `status` filter) | 400 via the query DTO. `@Type(() => Number)` is explicit because tsx does not emit decorator metadata | `test/payments.e2e.spec.ts` (`GET /payments`) |
| Non-UUID payment id | 400 from the params DTO before touching the database | `test/payments.e2e.spec.ts` (`GET /payments/:id`) |
| Payment not found | 404 `Payment <id> not found` (GET and PATCH) | `payments.service.spec.ts`; `test/payments.e2e.spec.ts` |
| Illegal status transition (final states, same status, PENDING -> SUCCEEDED, ...) | 409 naming both statuses, `details: { currentStatus, requestedStatus }` | `payment-status.spec.ts` (all 25 pairs); `payments.service.spec.ts`; `test/payments.e2e.spec.ts` |
| Client asks for PROCESSING | 400 "status PROCESSING is reserved for the payment processor"; only the processor may set it | `test/payments.e2e.spec.ts` |
| Invalid `Idempotency-Key` header (spaces, empty, > 255 chars, other characters) | 400 "Invalid Idempotency-Key header" | `test/payments.e2e.spec.ts` |
| Client retries a POST with the same `Idempotency-Key` | 200 with the original payment and `Idempotent-Replayed: true`; no second row | `payments.service.spec.ts`; `test/payments.e2e.spec.ts` |
| Same `Idempotency-Key` reused with a different body | 409 "Idempotency-Key has already been used with a different request" | `payments.service.spec.ts`; `test/payments.e2e.spec.ts` |
| Two concurrent POSTs with the same key pass the lookup together | The unique index lets one insert win; the repository raises `DuplicateIdempotencyKeyError` and the service re-reads and replays the winner (or 409 if its body differs) | The branch is guaranteed by `payments.service.spec.ts` (mocked race, match and mismatch). The e2e parallel test asserts one row and one id, but better-sqlite3 is synchronous, so it may not interleave at the lookup; it does not prove this branch |
| Status update loses a race with the processor or another request (including ABA: PENDING -> PROCESSING -> PENDING between read and write) | Compare-and-set on `status` AND `version`; zero rows affected means 409 reported against the fresh status, never an overwrite | `payments.service.spec.ts` (CAS lost); `test/payments.e2e.spec.ts` (stale version against real SQLite leaves the row untouched). A true two-request interleave through HTTP is untested |
| Timestamps depend on the host time zone | Stored and returned as UTC; API values end in `Z` | `test/payments.e2e.spec.ts` (TZ set to America/New_York) |
| `history` JSON mangled by the query builder | Verified the stored column is valid JSON after a CAS update | `test/payments.e2e.spec.ts` (repository CAS) |
