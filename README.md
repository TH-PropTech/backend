# TH PropTech Backend

NestJS modular monolith API for the TH PropTech platform.

## Requirements

- Node.js >= 22.11.0
- pnpm >= 10.0.0
- PostgreSQL >= 15

## Getting Started

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

The API runs at http://localhost:3001/api/v1.

If `pnpm` is not available globally, use Corepack:

```bash
corepack pnpm install
corepack pnpm db:up
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
- `pnpm db:up` - start local PostgreSQL for development and e2e
- `pnpm db:down` - stop local PostgreSQL
- `pnpm migration:generate -- src/core/database/migrations/<name>` - generate a migration
- `pnpm migration:run` - apply migrations

## Architecture

- `src/core` - config, database, logger, app bootstrap
- `src/common` - DTOs, filters, interceptors, guards, pipes, decorators
- `src/features` - bounded feature modules

Controllers stay thin, services contain business logic, repositories isolate data
access, and API responses use a consistent envelope.

## Folder Map

```text
src/
  core/                 # Config, database, logger, app bootstrap
  common/               # DTOs, filters, interceptors, guards, pipes, decorators
  features/health/      # Baseline health feature module
test/                   # Supertest e2e setup
docker/postgres/init/   # Local database initialization scripts
```

## Environment

Copy `.env.example` to `.env`.

| Variable               | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `APP_PORT`             | API port, default `3001`                               |
| `APP_CORS_ORIGINS`     | Comma-separated frontend origins                       |
| `DATABASE_HOST`        | PostgreSQL host                                        |
| `DATABASE_PORT`        | PostgreSQL port                                        |
| `DATABASE_USER`        | PostgreSQL username                                    |
| `DATABASE_PASSWORD`    | PostgreSQL password                                    |
| `DATABASE_NAME`        | PostgreSQL database                                    |
| `DATABASE_SSL`         | Enables PostgreSQL SSL                                 |
| `DATABASE_LOGGING`     | Enables TypeORM query logging                          |
| `DATABASE_SYNCHRONIZE` | Local-only schema sync switch; keep `false` by default |

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

## Database And Migrations

Start local PostgreSQL:

```bash
corepack pnpm db:up
```

Generate and run migrations:

```bash
corepack pnpm migration:generate -- src/core/database/migrations/<name>
corepack pnpm migration:run
```

Do not enable `DATABASE_SYNCHRONIZE=true` outside short-lived local
experiments. Production and shared environments must use reviewed migrations.

## CI Checklist

Run these before opening a PR:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

E2E tests require PostgreSQL:

```bash
corepack pnpm db:up
corepack pnpm test:e2e
```
