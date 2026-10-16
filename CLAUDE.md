# CLAUDE.md

Payment-processing simulation microservice (Node.js) with a React frontend. This is a take-home assessment graded on ownership, failure handling, background processing, security, code quality and completeness.

Keep everything simple and boring. Add no abstraction unless there is a clear need for it.

## Workflow (every task)

1. **Plan first.** List the files you will touch and the risks before writing code.
2. **Implement in small steps.**
3. **Comment non-obvious logic.** Explain WHY, not what.
4. **Write custom tests.** Cover failure and edge cases, not only the happy path.
5. **Verify.** Run lint, build and tests, and show the real output. Do not summarise or invent results.
6. **Finish with a commit message.** Write a descriptive Conventional Commits message, then wait for review. **Do not run `git commit` yourself.**

## Stack

- **Backend:** Express 5 (NOT NestJS), TypeScript in strict mode, TypeORM with SQLite (`better-sqlite3`), `class-validator` and `class-transformer` for DTOs, Jest and supertest for tests.
- **Frontend (later):** Vite, React, TypeScript.

## Architecture

- Feature modules laid out like NestJS, written in plain Express.
- Each module folder holds its `entity`, `dto`s, `repository`, `service`, `controller`, `routes` and a `module` file that wires them together by hand.
- Layers are controller → service → repository. Services never use TypeORM directly; only repositories do.
- No DI framework. Dependencies are passed explicitly through constructors.

## Data rules

- Money is an integer in minor units (e.g. cents). Never use a float.
- Timestamps are UTC.
- IDs are UUIDs.

## Errors

- Use typed `AppError` subclasses (e.g. `NotFoundError`, `ValidationError`, `ConflictError`).
- One global error-handling middleware.
- A single JSON error shape for every error response.
- Never leak stack traces or internal details to clients.

## Config and secrets

- Read config only through validated environment variables, and fail fast at startup if any is invalid.
- Never commit secrets. `.env` is gitignored; provide a `.env.example` instead.

## Documentation duties

- Every failure point you find goes into `docs/FAILURE_MODES.md`, together with the test that proves how it is handled.
- Be honest about anything untested: list it explicitly rather than implying coverage.
- `docs/REVIEW_LOG.md` records what the AI produced and what was changed or rejected, and why.
