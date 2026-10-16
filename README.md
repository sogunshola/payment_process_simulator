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
