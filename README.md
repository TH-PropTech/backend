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
- `pnpm migrate:data` - MongoDB data migrations (dry-run by default, see [MongoDB And Data Backfills](#mongodb-and-data-backfills))

The backend has no SQL migration command. The MongoDB data migrations in
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
  data/migrations/      # Reviewed MongoDB data migrations (007-031, no 029) and the migrate:data CLI
test/                   # Supertest e2e setup
```

## Cấu trúc module backend

`src/modules` gồm 20 module, chia theo 4 vai trò. `AppModule` import cả 20 module theo nhóm này. Với `check:cycles`, script đếm thêm 3 module hạ tầng nên báo 23 module tổng.

Quy ước mỗi module (mẫu `server_do_an_new`):

- Đúng 1 file `<module>.module.ts` ở gốc thư mục module; không có `*.module.ts` ở thư mục con.
- Thư mục con theo vai trò file, chỉ tạo khi có file: `controllers/`, `services/`, `dto/`, `schemas/`, `utils/` (module adapter/đặc thù có thêm như `providers/`, `gateways/`, `engine/`).
- Module lớn có thể có thư mục theo tính năng (ngoại lệ ghi rõ trong `scripts/check-module-structure.cjs`): `contracts/{commercial,flow,fonts,layout,legal,signed-artifact}`, `legal/data`, `properties/{mappers,insights,recommendations}`, `jobs/jobs`. `insights` và `recommendations` là thư mục tính năng của `properties`; adapter SmartCA (`providers/`, `gateways/`) nằm trong `contracts`.
- `*.schema.ts` chỉ nằm trong `schemas/`, không dùng đuôi `*.entity.ts`.
- Kiểm tự động: `pnpm check:structure` (quy ước thư mục) và `pnpm check:cycles` (không vòng phụ thuộc module, không `forwardRef`); cả hai chạy trong CI trước `lint`.
- `*.spec.ts` nằm cạnh file nguồn.
- `index.ts` chỉ có ở module dùng chung (hiện là `activity-log`, `rbac`).
- File lẻ ở gốc ngoài `*.module.ts`/`index.ts`: `jobs/base-job.ts`, `rbac/rbac.constants.ts`.
- Guards, decorators, interceptors, filters, logger dùng chung vẫn ở `src/common`.

| Vai trò       | Module                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cắt ngang     | `auth` (gồm two-factor, smart-otp), `rbac` (role/permission lưu DB), `activity-log`, `health` (gồm redis)                                                                                                                                                                                                                                                                                                                   |
| Domain        | `users` (gồm hồ sơ KYC), `properties` (căn hộ, tòa nhà, dự án, tin đăng, saved-searches, insights, recommendations), `bookings`, `rental` (rental-applications, rental-transactions, rental-flow-config, move-in-settlements), `contracts` (gồm property-ownership-transfer, ký số SmartCA), `payments` (gồm platform-fees), `wallets` (gồm payouts), `legal`, `community` (gồm support-tickets, disputes), `notifications` |
| Adapter ngoài | `fabric`, `ekyc` (eKYC proxy, OCR, biometric), `ai` (Groq, ai-chats, ai-consultation), `mock-bank`                                                                                                                                                                                                                                                                                                                          |
| Vận hành      | `admin` (controller admin lẻ), `jobs` (scheduler/job, lịch sử chạy)                                                                                                                                                                                                                                                                                                                                                         |

`rental` là `@Global()`: mọi module khác dùng provider của nó (gồm phần rental-flow-config và move-in-settlements đã gộp vào) qua inject trực tiếp, không cần khai `imports:`. Hai cặp còn lại (`platform-fees` → `payments`, `property-ownership-transfer` → `contracts`) từng tách riêng vì vòng phụ thuộc thật; đã gộp bằng cách lazy-resolve provider qua `ModuleRef` tại đúng điểm gọi cần, thay vì import module trực tiếp (xem `fabric-governance.service.ts`, `payments.service.ts`). Toàn bộ `src` không dùng `forwardRef`.

### Entity: gom hay giữ

Chuẩn hóa theo mẫu `server_do_an_new` nhưng **không xóa gì**: entity đã gom giữ lại file schema với `@deprecated`, bỏ khỏi `TypeOrmModule.forFeature`, collection cũ còn nguyên; dữ liệu được sao sang cấu trúc mới bằng migration `007`–`031` (không có `029`; dry-run mặc định, idempotent, kiểm đếm, có rollback).

Đích là **41 entity nạp** = 40 entity theo đích đã chốt + `PropertyOwnershipTransferRecord`, giữ riêng vì không có cận trên số bản ghi (không nhúng vào `PropertyOwnershipTransfer.records[]` được). Tổng 85 file `@Entity`: 41 nạp và 44 `@deprecated`.

| Đã gom                                                                                | Thành                                                                                                                                                                                                   | Migration |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `DeviceBinding`                                                                       | nhúng `User.smartOTP.devices[]` (ghi bằng `$push`/`$set` nguyên tử)                                                                                                                                     | 007       |
| `TicketMessage`                                                                       | nhúng `SupportTicket.messages[]` (tối đa 500, 409 khi vượt)                                                                                                                                             | 008       |
| `CommunityPost` + `CommunityComment`                                                  | `CommunityEntry{kind}` (collection `community_entries`, giữ `_id`)                                                                                                                                      | 009       |
| `ContractLayoutAudit`, `ContractTemplateAudit`, `PlatformFeeAudit`, `RentalFlowAudit` | `ConfigAudit{scope}` (collection `config_audits`, giữ `_id`); từ 031 tiếp tục gom vào `ActivityLog` (xem dưới)                                                                                          | 010       |
| `ContractArtifact` + `ContractSignedArtifact`                                         | `ContractDocument{kind:'canonical' \| 'signed'}` (collection `contract_documents`, giữ `_id`; unique `(contractId, revision, amendmentId)` chỉ cho `canonical` bằng partial index do migration tạo)     | 011       |
| `MaintenanceTicket`                                                                   | nhúng `Apartment.maintenanceTickets[]` (tối đa 100 phiếu, 20 ảnh/phiếu; chỉ ghi bằng `updateOne` `$push` có trần qua `MaintenanceTicketsService`)                                                       | 012       |
| `JobConfig` + `RecommendationConfig`                                                  | `SystemConfig{scope:'job' \| 'recommendation'}` (collection `system_configs`, giữ `_id`; unique `(scope, key)` do migration tạo; `GET/PUT recommendations/engine-config` giữ hình cũ, không lộ `scope`) | 013       |
| `RentalFlowProfile` + `RentalExecutionPolicy`                                         | `RentalFlowConfig{kind:'profile' \| 'policy'}` (collection `rental_flow_configs`, giữ `_id`; hai entity cũ không có unique nên chỉ có chỉ mục `(kind, key, status, version)` do migration tạo)          | 014       |
| `ListingReviewCase` + `SafetyReport`                                                  | `ReviewCase{kind:'listing' \| 'safety'}` (collection `review_cases`, giữ `_id`; chỉ mục `(kind, status, createdAt)`)                                                                                    | 015       |
| `SavedSearch` + `SearchAlert`                                                         | `SavedSearchRecord{kind:'search' \| 'alert'}` (collection `user_searches`, giữ `_id`, giữ `deduplicationKey`)                                                                                           | 016       |
| `Permission`                                                                          | nhúng `Role.permissions[]` (trần 6 action x 19 subject; khử trùng `(action, subject)`)                                                                                                                  | 019       |
| `LegalKnowledgeDoc`, `LegalSource`, `PlatformRegulation`, `LegalTermsDocument`        | `LegalDocument{kind}` (collection `legal_documents`; `LegalSource.kind` đổi thành `docKind`; partial unique `key`/`code` chỉ khi dữ liệu thỏa)                                                          | 020       |
| `EmailOtp` + `TransactionOtp`                                                         | `Otp{kind:'email' \| 'transaction'}` (collection `otps`, giữ `_id`)                                                                                                                                     | 021       |
| `GroqApiKey` + `PlatformFeeSchedule`                                                  | `SystemConfig{scope:'groq-key' \| 'platform-fee'}` (collection `system_configs`, giữ `_id`; partial unique `keyHash` / `(scheduleId, version)`; khóa vẫn mã hóa; hai entity cũ `@deprecated`)           | 022       |
| `AiConsultationLog`, `BlockchainLog`, `JobRunHistory`, `RecommendationHistory`        | `ActivityLog{kind}` (collection `activity_logs`, giữ `_id`)                                                                                                                                             | 023       |
| `RentalFlowAssignment`                                                                | `RentalFlowConfig{kind:'assignment'}` (cùng collection `rental_flow_configs`)                                                                                                                           | 024       |
| `ContractLayoutProfile`                                                               | `ContractTemplate{kind:'layout'}` (collection `contract_templates`; layout nằm cùng bảng mẫu hợp đồng)                                                                                                  | 025       |
| `KycRecord`                                                                           | nhúng `User.kyc` (`KycInfo`); `kyc.recordId` = `_id` cũ, nên `GET/PATCH /kyc/:id` vẫn tra được                                                                                                          | 026       |
| `ContractAmendment`                                                                   | nhúng `Contract.amendments[]` (có trần; không tạo unique mới)                                                                                                                                           | 027       |
| `SigningGrant`                                                                        | `SmartCaSigningSession{kind:'grant'}` (collection `smartca_signing_sessions`; phiên giao dịch là `kind:'session'`)                                                                                      | 028       |
| `Review`                                                                              | nhúng `Apartment.reviews[]` (trần 100 review/căn hộ; không có service/controller nào đọc, dữ liệu chỉ được giữ)                                                                                         | 030       |
| `ConfigAudit` (`config_audits`)                                                       | `ActivityLog{kind:'config-audit'}` (giữ `_id`, không xóa `config_audits`; entity `ConfigAudit` `@deprecated`)                                                                                           | 031       |

> Đã gỡ `AreaProfile`/`RiskLayerData` (`district_data`) và `ConditionAnalysis`/`LivingCostProfile` (`apartment_analyses`) cùng các endpoint `area-profiles`, `location-risk`, `condition-analyses`, `living-cost` khi rút gọn trang chi tiết căn hộ. Migration 017/018 được giữ nguyên cho lịch sử; hai collection không còn entity và dữ liệu cũ vẫn nằm trong DB (không bị xoá).

`PropertyOwnershipTransferRecord` vẫn là entity riêng (không có trong bảng vì không gom): nằm trong 41 entity nạp.

Quy ước khi gom: (1) chỉ gom khi mọi truy vấn cũ viết lại được mà kết quả không đổi, có test phủ trước khi đổi; (2) entity hợp nhất theo `kind`/`scope` bắt buộc lọc trường phân loại ở **mọi** truy vấn, và API không lộ trường đó (ánh xạ về hình JSON cũ); (3) giữ `_id` cũ; (4) giữ union chuỗi, không đổi sang `export enum`; (5) entity có `_id` làm khóa ledger/bằng chứng, hàng đợi hoặc claim nguyên tử chỉ gom khi giữ được `_id` cũ (hoặc id công khai như `kyc.recordId`), ghi nhúng/upsert bằng điều kiện nguyên tử, và unique chỉ tạo bằng partial index của migration khi dữ liệu thỏa. Truy vấn đi qua facade repository giữ chữ ký cũ và tự thêm điều kiện `kind`/`scope`. Đã gom theo cách này: `KycRecord` (026), `ContractAmendment` (027), `SigningGrant` (028). `LedgerOutbox` vẫn là collection riêng, không có migration gom. Ba điểm đổi hành vi **có chủ ý** của phép gom `DeviceBinding`: (1) `smartOTP.registeredDevices` nay được `$inc` mỗi lần bind (code cũ không cập nhật); (2) user cũ/seed nhận object `smartOTP` mặc định ở lần bind/OTP đầu tiên; (3) bind cho `userId` không phải ObjectId trả 400, user không tồn tại trả 404. Ngoài ra `GET /users/me` và `GET /users` không trả `smartOTP.devices`. Cách chạy migration: xem mục [MongoDB And Data Backfills](#mongodb-and-data-backfills).

Ngoài ra `pnpm check:structure` không kiểm quy tắc "spec nằm cạnh file nguồn" (một số spec tích hợp không có file nguồn cùng tên).

### `wallets` — không lưu ký (non-custodial)

Sàn **không giữ tiền** của người dùng. Entity `Wallet` (`wallets/schemas/wallet.schema.ts`, collection `mock_bank_wallets`) chỉ là **liên kết tới tài khoản ngân hàng** nhận tiền của chủ nhà (ngân hàng, chủ tài khoản, 4 số cuối, trạng thái `linked`/`unlinked`) — không có số dư, không có sổ cái nội bộ.

- **Payout** (`wallets/services/payouts.service.ts`) chỉ ghi nhận trạng thái chuyển tiền tới tài khoản liên kết (`pending` → `paid-out`/`failed`), không cộng số dư.
- **Sao kê** (`GET /wallet/transactions`) dựng động từ `Payout` (`paid-out`) và `Payment` (hóa đơn `platform-fee` đã trả) của đúng người dùng, không đọc từ sổ cái.
- **Hoa hồng sàn** chỉ trả qua cổng thanh toán (`POST /bank/invoice/init` + callback), không còn trả bằng số dư ví; route cũ `POST /bank/wallet/pay-invoice` trả `410 Gone`.
- Entity `WalletTransaction` (`wallet_transactions`) và các trường `balance`/`totalReceived`/`totalFeesPaid` cũ trong document Mongo được **giữ nguyên, đánh dấu `@deprecated`**, không bị xóa hay đọc/ghi nữa — dùng cho đối chiếu dữ liệu lịch sử nếu cần, không phải nguồn sự thật cho API.
- Xem `openspec/changes/non-custodial-wallets` (hoặc bản đã archive trong `openspec/specs/landlord-wallet`, `openspec/specs/landlord-payout`) để biết đầy đủ quyết định thiết kế.

## Environment

Copy `.env.example` to `.env`.

| Variable                    | Purpose                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_PORT`                  | API port, default `3001`                                                                                                                        |
| `APP_CORS_ORIGINS`          | Comma-separated frontend origins                                                                                                                |
| `DATABASE_URL`              | MongoDB connection URI; use the hosted URI in shared environments                                                                               |
| `DATABASE_LOGGING`          | Enables TypeORM query logging                                                                                                                   |
| `DATABASE_SYNCHRONIZE`      | Local-only MongoDB entity sync switch; keep `false` in shared/production environments. Xem lưu ý tên chỉ mục trong mục MongoDB                  |
| `PAYMENT_PROVIDERS_ENABLED` | Gateways tenants may choose: `mock-bank,momo,zalopay,mocbank` (default `mock-bank`). Listing one makes its `MOMO_*` / `ZALOPAY_*` keys required |

> VNPAY has been removed (`VNPAY_*` env vars and `/bank/vnpay/*` routes are gone; listing `vnpay` in `PAYMENT_PROVIDERS_ENABLED` is now a validation error). See `.env.example` for tunnel setup when testing gateway IPN callbacks locally.

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

Khi `DATABASE_SYNCHRONIZE=true`, TypeORM tự tạo chỉ mục từ `@Index` của entity. Tên `@Index` phải trùng tên `createIndex` mà migration tương ứng dùng; nếu không, cùng khóa nhưng khác tên sẽ gây xung đột (Mongo `IndexOptionsConflict`). `src/data/migrations/index-names.consistency.spec.ts` kiểm việc này. Chỉ mục unique/partial trong migration (ví dụ `contract_documents_canonical_contract_revision_amendment_unique`) không khai báo trong entity vì TypeORM không tạo được `partialFilterExpression`.

Reviewed legal lease templates are seeded idempotently by the contracts module
at application bootstrap when their canonical keys are missing. Existing
published legal templates are never overwritten by bootstrap.

### Chạy migration dữ liệu

Các migration nằm ở `src/data/migrations` (`007`–`031`, không có `029`), chạy qua CLI `pnpm migrate:data` (`scripts/run-migration.cjs` → `dist/data/migrations/migration.cli.js`). Chạy `pnpm build` trước để có `dist`. Bắt buộc có `DATABASE_URL` trỏ tới DB cần xử lý.

```bash
pnpm migrate:data                       # dry-run toàn bộ (mặc định, không ghi)
pnpm migrate:data -- --apply            # áp dụng thật, có checkpoint
pnpm migrate:data -- --only=020,021     # chọn bước (apply luôn theo thứ tự chuẩn)
pnpm migrate:data -- --rollback         # dry-run hoàn tác (thứ tự ngược)
pnpm migrate:data -- --rollback --apply # hoàn tác thật
```

- Dry-run là mặc định; dry-run không bao giờ ghi checkpoint. Checkpoint lưu ở collection `migration_checkpoints`.
- `--rollback --only=` luôn hoàn tác theo thứ tự ngược của danh sách chuẩn, không theo thứ tự gõ; `--only` không đổi thứ tự apply hay rollback.
- Thứ tự phụ thuộc đã được CLI đảm bảo khi chạy không kèm `--only`: 013 trước 022, 014 trước 024, 011 và 013 trước 025, 023 trước 031.

### Thứ tự vận hành

1. `mongodump` toàn bộ database trước mọi thao tác.
2. `pnpm build`, rồi dry-run trên **bản sao** của database (`DATABASE_URL` trỏ bản sao): `pnpm migrate:data`. Đọc report: không được có lỗi dừng; các mục `orphans`, `conflicts`, `duplicateIds`, `oversized` phải được xử lý hoặc chấp nhận có chủ đích.
3. `pnpm migrate:data -- --apply` trên cùng bản sao. Kiểm đếm do migration tự chạy phải đạt.
4. Kiểm tra bản sao sau khi áp dụng (đếm bản ghi, chạy e2e nếu có DB test).
5. Chỉ sau đó mới áp dụng cho database thật và **deploy code**.

Các migration **PHẢI chạy trước khi deploy code** mới: `020` (partial unique `key`/`code` của `legal_documents`; nếu chạy sau, `seedIfEmpty` seed trùng key), `021` (`otps`), `023` (`activity_logs`), `025` (`contract_templates` kind layout), `026` (`users.kyc`), `028` (`smartca_signing_sessions`, unique `providerTransactionId`/`tokenHash`), và các migration còn lại trong danh sách trên khi code mới đọc collection đích.

> **Cảnh báo DB dùng chung:** không chạy `pnpm migrate:data -- --apply` (hay `--rollback --apply`) trên database dùng chung hoặc production khi chưa xác nhận với người phụ trách; luôn thử trên bản sao trước.

> **Cảnh báo dừng ghi:** khi chạy `023` và `028` phải **dừng mọi ghi** vào collection nguồn (tạm dừng backend hoặc chặn ghi). `023` cần vì lô đọc theo cursor và `AiConsultationLog.messages[]` có trần; `028` cần vì grant đang ký có thể đổi giữa lúc sao. Rollback sao ngược được phần ghi sau chuyển code, nhưng không thay thế việc dừng ghi khi áp dụng.

Migration không xóa collection cũ (`config_audits`, `signing_grants`, `contract_artifacts`, ...); rollback chỉ xóa/`$unset` ở đích khi đã sao đủ. Việc xóa collection cũ là bước riêng, ngoài phạm vi migration.

### Việc ngoài phạm vi (chưa xử lý)

- Race ký đồng thời của `SigningGrant`/`SmartCaSigningSession`: vẫn `findOne` + `save`, không nguyên tử (chủ đích, D6).
- OTP không nguyên tử: `Otp` giữ `findOne` + `save`, không đổi sang `findOneAndUpdate`.
- Seed trùng `asgn-global-seed`: cấu hình gán toàn cục có thể bị seed trùng, chưa xử lý.
- `count({ where })` và `IsNull()` trên `MongoRepository`: không dùng được như trên repository SQL; truy vấn mới dùng filter thô (ví dụ `{ field: null }`).

## CI Checklist

Run these before opening a PR:

```bash
corepack pnpm format:check
corepack pnpm check:structure
corepack pnpm check:cycles
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

E2E tests require a reachable MongoDB configured by `DATABASE_URL`:

```bash
corepack pnpm test:e2e
```

## Chatbot pháp lý: chất lượng tra cứu

- `legal_knowledge_chunks` chỉ là dữ liệu dẫn xuất từ `legal_documents.content`. Nhiều trang luật được trích với ngắt dòng cứng ở khoảng 80 ký tự (cả giữa tiêu đề và giữa câu); bộ cắt (`legal-chunker`) nối lại các dòng đó trước khi cắt. Đổi logic cắt thì dựng lại chunk:

  ```bash
  pnpm build
  node scripts/rechunk-legal.cjs                          # chạy thử, chỉ in so sánh
  node scripts/rechunk-legal.cjs --apply --backup f.json  # ghi, có sao lưu chunk cũ
  node scripts/rechunk-legal.cjs --restore f.json         # khôi phục
  ```

- Bước trả lời sau tra cứu dùng lời nhắc gọn riêng (`LEGAL_ANSWER_PROMPT`, không kèm định nghĩa công cụ). Lời nhắc tổng cộng định nghĩa công cụ đã vượt ngân sách token mỗi yêu cầu, khiến đoạn tra cứu bị rút còn ~400 ký tự.
- Câu trả lời pháp lý đi qua `legal-answer-guard`: số liệu (tháng, ngày, %, tiền) và số điều/nghị định phải có trong đoạn trích; điều luật chỉ áp dụng cho một loại nhà (nhà ở xã hội, công vụ, thuê khoán...) được gắn ghi chú phạm vi.
- Bộ câu hỏi kiểm tra chạy tay trên backend đang chạy (cần khoá Groq; mô hình không tất định nên đọc cả câu trả lời): `node scripts/legal-eval.cjs [--only id1,id2] [--json out.json]`.
