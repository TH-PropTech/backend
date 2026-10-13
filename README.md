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

## Cấu trúc module backend

`src/modules` gồm 27 module, chia theo 4 vai trò. `AppModule` import cả 27 module theo nhóm này.

Quy ước mỗi module (mẫu `server_do_an_new`):

- Đúng 1 file `<module>.module.ts` ở gốc thư mục module; không có `*.module.ts` ở thư mục con.
- Thư mục con theo vai trò file, chỉ tạo khi có file: `controllers/`, `services/`, `dto/`, `schemas/`, `utils/` (module adapter/đặc thù có thêm như `providers/`, `gateways/`, `engine/`).
- `*.spec.ts` nằm cạnh file nguồn.
- `index.ts` chỉ có ở module dùng chung (hiện là `activity-log`, `rbac`).
- File lẻ ở gốc ngoài `*.module.ts`/`index.ts`: `jobs/base-job.ts`, `rbac/rbac.constants.ts`.
- Guards, decorators, interceptors, filters, logger dùng chung vẫn ở `src/common`.

| Vai trò       | Module                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cắt ngang     | `auth` (gồm two-factor, smart-otp), `rbac` (role/permission lưu DB), `activity-log`, `health` (gồm redis)                                                                                                                                                                                                                                                                                                      |
| Domain        | `users` (gồm hồ sơ KYC), `properties` (căn hộ, tòa nhà, dự án, tin đăng, saved-searches), `bookings`, `rental` (rental-applications, rental-transactions), `rental-flow-config`, `move-in-settlements`, `contracts`, `property-ownership-transfer`, `payments`, `platform-fees`, `wallets` (gồm payouts), `legal`, `insights`, `recommendations`, `community` (gồm support-tickets, disputes), `notifications` |
| Adapter ngoài | `fabric`, `digital-signature` (SmartCA provider/gateway), `ekyc` (eKYC proxy, OCR, biometric), `ai` (Groq, ai-chats, ai-consultation), `mock-bank`                                                                                                                                                                                                                                                             |
| Vận hành      | `admin` (controller admin lẻ), `jobs` (scheduler/job, lịch sử chạy)                                                                                                                                                                                                                                                                                                                                            |

Bốn module lá được giữ riêng vì gộp vào module domain tương ứng sẽ tạo vòng phụ thuộc module: `platform-fees`, `property-ownership-transfer`, `rental-flow-config`, `move-in-settlements`. Toàn bộ `src` không dùng `forwardRef`.

### `wallets` — không lưu ký (non-custodial)

Sàn **không giữ tiền** của người dùng. Entity `Wallet` (`wallets/schemas/wallet.schema.ts`, collection `mock_bank_wallets`) chỉ là **liên kết tới tài khoản ngân hàng** nhận tiền của chủ nhà (ngân hàng, chủ tài khoản, 4 số cuối, trạng thái `linked`/`unlinked`) — không có số dư, không có sổ cái nội bộ.

- **Payout** (`wallets/services/payouts.service.ts`) chỉ ghi nhận trạng thái chuyển tiền tới tài khoản liên kết (`pending` → `paid-out`/`failed`), không cộng số dư.
- **Sao kê** (`GET /wallet/transactions`) dựng động từ `Payout` (`paid-out`) và `Payment` (hóa đơn `platform-fee` đã trả) của đúng người dùng, không đọc từ sổ cái.
- **Hoa hồng sàn** chỉ trả qua cổng thanh toán (`POST /bank/invoice/init` + callback), không còn trả bằng số dư ví; route cũ `POST /bank/wallet/pay-invoice` trả `410 Gone`.
- Entity `WalletTransaction` (`wallet_transactions`) và các trường `balance`/`totalReceived`/`totalFeesPaid` cũ trong document Mongo được **giữ nguyên, đánh dấu `@deprecated`**, không bị xóa hay đọc/ghi nữa — dùng cho đối chiếu dữ liệu lịch sử nếu cần, không phải nguồn sự thật cho API.
- Xem `openspec/changes/non-custodial-wallets` (hoặc bản đã archive trong `openspec/specs/landlord-wallet`, `openspec/specs/landlord-payout`) để biết đầy đủ quyết định thiết kế.

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
