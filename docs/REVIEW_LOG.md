# AI-Assisted Development — Review Log

A record of AI-assisted implementation work, the human decisions made during review, and the reasons behind those decisions.

**Review date:** October 20, 2026  
**Overall status:** All workstreams reviewed and approved.

## Review status at a glance

| # | Workstream | Review status |
|---|---|---|
| 1 | Frontend foundation | Reviewed and approved |
| 2 | Chaos Arena | Reviewed and approved |
| 3 | Frontend polish and end-to-end coverage | Reviewed and approved |
| 4 | Server-generated payment references | Reviewed and approved |
| 5 | BullMQ payment processing migration | Reviewed and approved |

---

## 1. Frontend foundation

**Request**

Build a frontend scaffold using Vite, React, and Tailwind, including the application's API integration and foundational UI.

**AI-produced work**
- Created the `frontend/` scaffold.
- Added a typed API client with `ApiError` mapping.
- Added TanStack Query hooks.
- Built reusable UI primitives, a settings dialog, and a connection indicator.
- Added placeholder routes for the Console and Chaos Arena.
- Added tests and documentation entries.

**Human review / changes**

Reviewed the frontend architecture, API integration, component structure, and foundational UI. Accepted the implementation as suitable for the application's requirements.

**Reasoning**

The implementation provides a structured, maintainable frontend foundation with reusable components, typed API communication, and consistent data-fetching patterns.

**Status:** Reviewed and approved.

---

## 2. Chaos Arena

**Request**

Implement an interactive game at `/arena` that uses the gateway configuration to run rounds and simulate failures.

**AI-produced work**
- Created `frontend/src/features/arena/*` and `pages/Arena.tsx`.
- Implemented the canvas pipeline, rounds using `PUT /gateway/config`, powers, scoring, and SLA tracking.
- Added incident reporting.
- Implemented gateway snapshot and restoration when leaving or unloading the Arena.
- Added an API client keepalive option.
- Added tests and updated `FAILURE_MODES` and README documentation.

**Human review / changes**

Reviewed the Arena implementation, gateway configuration interactions, failure simulation, scoring, and restoration behavior. Accepted the implementation and its supporting tests.

**Reasoning**

The Arena provides an interactive way to demonstrate gateway behavior under different failure conditions. Preserving and restoring gateway configuration helps prevent simulation activity from unintentionally affecting subsequent operations.

**Status:** Reviewed and approved.

---

## 3. Frontend polish, accessibility, and end-to-end tests

**Request**

Improve the frontend's usability, resilience, accessibility, payment flow, and test coverage.

**AI-produced work**
- Made navigation and Arena responsive.
- Added an `ErrorBoundary` and a backend-unreachable banner.
- Improved dialog accessibility, Arena controls, and contrast testing.
- Lazy-loaded the Arena.
- Added a minimal **New payment** flow and recent-payments list.
- Expanded Vitest coverage and added Playwright end-to-end tests and screenshots.
- Updated `docs/ACCESSIBILITY.md`, `docs/media/*`, `FAILURE_MODES`, and README.

**Human review / changes**

Reviewed the UI improvements, error handling, accessibility adjustments, payment interactions, and automated test coverage. Accepted the changes.

**Reasoning**

These improvements make the application more usable, responsive, accessible, and resilient. Automated tests provide additional regression protection for important user interactions.

**Status:** Reviewed and approved.

---

## 4. Generate payment references on the server

**Request**

Move payment `reference` generation from the client to the server.

**AI-produced work**
- Added `payment-reference.ts` to generate references using `crypto.randomBytes`.
- Added a unique database index and bounded retries on reference collision.
- Updated the repository, service, DTO, and entity.
- Removed the reference field from the frontend payment modal and Arena.
- Added tests and documentation updates.

**Human review / changes**

Reviewed and approved the decision to generate payment references on the server rather than relying on client-supplied values.

Confirmed the design incorporates database-enforced uniqueness and bounded collision retries.

**Reasoning**

Client-generated references cannot be relied upon to maintain uniqueness or integrity. The previous database column also lacked a unique constraint.

Generating references using cryptographically secure randomness significantly reduces collision probability. However, the **database unique index provides the actual uniqueness guarantee**, while bounded retries handle rare collisions safely.

This keeps reference generation under server control and strengthens payment data integrity.

**Status:** Reviewed and approved.

---

## 5. Migrate the payment processor to BullMQ

**Request**

Replace the custom polling-based payment processor with BullMQ on Redis. BullMQ should handle queueing, retries, and crash recovery, while application code retains payment-specific state transitions.

### AI-produced work

- Added `bull-payment-queue.ts` with one `charge` job per payment (`jobId = paymentId`).
- Added BullMQ-managed retries and worker concurrency.
- Changed `payment-processor.ts` to a handler-only implementation with `handle(job)`, `RetryableError`, and a custom backoff strategy.
- Added a `PaymentQueue` interface integrated into `PaymentsService`.
- Added `processing.module.ts` to manage Redis probing, startup reconciliation, worker lifecycle, and shutdown.
- Updated `docker-compose.yml` and documentation.
- Added tests, including an optional integration test using real Redis.

### Human review: removed

Reviewed and removed obsolete functionality from the previous polling-based implementation:

- Polling loop and timers.
- `processDue` and `runTick`.
- `stop()` drain logic.
- `recoverStuck` and its single-instance assumption.
- `findDue` and its tests.
- `PROCESSOR_POLL_INTERVAL_MS` and `PROCESSOR_BATCH_SIZE` settings.

**Reasoning**

BullMQ now manages queue scheduling, retries, and worker recovery. Retaining the previous polling and recovery mechanisms would introduce unnecessary complexity and duplicate responsibilities already handled by the queue infrastructure.

### Human review: preserved

Reviewed and retained the following payment-safety mechanisms:

- **Version-checked compare-and-swap (CAS)** on every payment state change.
- **Abort-plus-race gateway timeout** handling.
- **Declines treated as final**, rather than transient failures.
- **Full-jitter backoff**, implemented as a custom BullMQ backoff strategy that returns the delay already stored by the handler in `nextAttemptAt`.

**Reasoning**

Although BullMQ handles job execution and retries, it does not understand payment-specific business rules or protect against every concurrent database update.

Application-level state validation, CAS checks, timeout handling, and failure classification must therefore remain part of the payment processing logic.

### Human review: additional changes

Two improvements were identified and incorporated during review.

**1. Re-enqueue `PROCESSING` payments during startup reconciliation**

Payments already marked `PROCESSING` could remain stuck indefinitely if Redis loses its queue data.

Startup reconciliation now accounts for these records and re-enqueues them where necessary.

**Reasoning:** This improves recovery after Redis data loss and reduces the risk of payments becoming permanently stuck.

**2. Disable the offline queue on the producer's Redis connection**

Disabled Redis client offline queueing for payment job production.

**Reasoning:** During a Redis outage, HTTP requests should fail promptly rather than wait indefinitely for queued Redis commands to execute.

### Final human review decision

Reviewed and approved the BullMQ migration, including its architectural changes, queue integration, retry handling, worker lifecycle, startup reconciliation, and Redis outage behavior.

The final design separates responsibilities appropriately:

- **BullMQ:** Queueing, scheduling, retries, concurrency, and worker recovery.
- **Application logic:** Payment state transitions, CAS protection, failure classification, gateway timeouts, and payment-specific retry decisions.
- **Database:** Durable payment records, consistency constraints, and state/version validation.

**Status:** Reviewed and approved.

---

## Final review checklist

- [x] Review and approve the frontend scaffold and API integration.
- [x] Review Chaos Arena behavior, gateway configuration updates, and restoration logic.
- [x] Review responsive UI, accessibility changes, payment flow, and automated tests.
- [x] Review uniqueness guarantees and collision retry behavior for server-generated references.
- [x] Review BullMQ worker behavior, retries, concurrency, and startup reconciliation.
- [x] Review Redis outage handling and payment state-transition safety.
- [x] Document human decisions, changes, and associated technical reasoning.
- [x] Update all workstream statuses and record final approval.

---

## Final human review summary

All five AI-assisted development workstreams have undergone human review and have been approved.

The review covered the frontend architecture, interactive Chaos Arena, user experience improvements, payment reference generation, and payment processing infrastructure.

Human oversight included evaluating implementation decisions, removing obsolete processing mechanisms, preserving critical payment-safety guarantees, and introducing additional recovery and reliability improvements.

AI was used to accelerate implementation, while architectural decisions, business-rule preservation, and final acceptance remained under human control.

**Final status: All workstreams reviewed and approved.**