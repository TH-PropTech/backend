# TH PropTech Backend

NestJS modular monolith API for the TH PropTech platform.

## Requirements

- Node.js >= 22.13.0
- pnpm >= 10.0.0
- MongoDB 6+ (local or hosted MongoDB-compatible deployment)

## Getting Started

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL to the local or hosted MongoDB instance in .env
pnpm dev
```

The API runs at http://localhost:3001/api/v1.

If `pnpm` is not available globally, use Corepack:

```bash
corepack pnpm install
corepack pnpm dev
```

Swagger/OpenAPI is available at http://localhost:3001/api/docs.

## Scripts

- `pnpm dev` - start local NestJS development server
- `pnpm build` - compile to `dist`
- `pnpm start` - run compiled app
- `pnpm typecheck` - run TypeScript checks
- `pnpm lint` - run ESLint
- `pnpm test` - run unit tests with coverage
- `pnpm test:e2e` - run API e2e tests
- `pnpm db:up` - optionally start local MongoDB from Docker Compose
- `pnpm db:down` - stop local MongoDB/Redis Compose services
- `pnpm db:logs` - follow local MongoDB logs
- `pnpm seed` - insert local/sample data; use only against an intentionally disposable database

The backend has no SQL migration command. The MongoDB data-backfill utilities in
`src/data/migrations` are reviewed, manual operations for historical records;
they are not executed automatically at application startup.

## Architecture

- `src/config` - environment and application configuration
- `src/common` - DTOs, filters, interceptors, guards, pipes, decorators
- `src/modules` - bounded feature modules

Controllers stay thin, services contain business logic, repositories isolate data
access, and API responses use a consistent envelope.

## Folder Map

```text
src/
  config/               # Environment and application configuration
  common/               # DTOs, filters, interceptors, guards, pipes, decorators
  modules/              # Bounded feature modules
  data/migrations/      # Optional reviewed MongoDB data-backfill utilities
test/                   # Supertest e2e setup
```

## Environment

Copy `.env.example` to `.env`.

| Variable                    | Purpose                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_PORT`                  | API port, default `3001`                                                                                                                                  |
| `APP_CORS_ORIGINS`          | Comma-separated frontend origins                                                                                                                          |
| `DATABASE_URL`              | MongoDB connection URI; use the hosted URI in shared environments                                                                                         |
| `DATABASE_LOGGING`          | Enables TypeORM query logging                                                                                                                             |
| `DATABASE_SYNCHRONIZE`      | Local-only MongoDB entity sync switch; keep `false` in shared/production environments                                                                     |
| `PAYMENT_PROVIDERS_ENABLED` | Gateways tenants may choose: `mock-bank,vnpay,momo,zalopay` (default `mock-bank`). Listing one makes its `VNPAY_*` / `MOMO_*` / `ZALOPAY_*` keys required |

> **Breaking:** `VNPAY_GATEWAY_URL` (the local `:8888` VNPAY bridge) is gone. The backend now signs VNPAY URLs itself, so set `VNPAY_TMN_CODE` and `VNPAY_HASH_SECRET` instead. See `.env.example` for tunnel setup when testing gateway IPN callbacks locally.

## API Contract

The API is versioned under `/api/v1`.

Baseline endpoints:

- `GET /api/v1/health`
- `GET /api/docs`

Successful responses use:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "timestamp": "2026-06-08T04:30:00.000Z"
  }
}
```

Error responses use the same envelope with `success: false`, `data: null`, and
a stable `error.code`.

## MongoDB And Data Backfills

The backend uses TypeORM with MongoDB. MongoDB does not use SQL schema
migrations. In local development, `DATABASE_SYNCHRONIZE=true` may be enabled
to add entity fields; keep it disabled for hosted and production databases.

Reviewed legal lease templates are seeded idempotently by the contracts module
at application bootstrap when their canonical keys are missing. Existing
published legal templates are never overwritten by bootstrap.

The numbered files under `src/data/migrations` are optional repository-level
MongoDB data backfills for historical records. They support dry-run/idempotent
operation but have no automatic CLI or startup runner. Snapshot the database,
review the report, and invoke a specific backfill only through an explicitly
reviewed operator job.

## CI Checklist

Run these before opening a PR:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

E2E tests require a reachable MongoDB configured by `DATABASE_URL`:

```bash
corepack pnpm test:e2e
```
