/**
 * run-migration.cjs
 * Chạy migration dữ liệu 007–031 (trừ 029; nhúng/gộp collection) từ mã đã build.
 * `--only` chỉ chọn bước; thứ tự chạy luôn theo thứ tự chuẩn (không theo thứ tự gõ).
 *
 * Cách dùng (cần `node node_modules/@nestjs/cli/bin/nest.js build` trước):
 *   DATABASE_URL=<uri> node scripts/run-migration.cjs                 # dry-run (mặc định, không ghi)
 *   DATABASE_URL=<uri> node scripts/run-migration.cjs --apply         # áp dụng + checkpoint
 *   DATABASE_URL=<uri> node scripts/run-migration.cjs --only=007,009  # chọn bước
 *   DATABASE_URL=<uri> node scripts/run-migration.cjs --rollback          # dry-run hoàn tác (thứ tự ngược)
 *   DATABASE_URL=<uri> node scripts/run-migration.cjs --rollback --apply  # hoàn tác thật
 *
 * Quy trình khuyến nghị: mongodump -> dry-run -> --apply trên bản sao DB ->
 * kiểm tra -> triển khai code. Không chạy trên DB dùng chung khi chưa xác nhận.
 * Checkpoint lưu ở collection `migration_checkpoints`; dry-run không bao giờ checkpoint.
 */

'use strict'

const { MongoClient } = require('mongodb')
const path = require('path')

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error(
    'Thiếu biến môi trường DATABASE_URL. Ví dụ: DATABASE_URL=<uri> node scripts/run-migration.cjs [--apply]'
  )
  process.exit(1)
}

async function main() {
  const { runMigrationCli } = require(
    path.join(__dirname, '..', 'dist', 'data', 'migrations', 'migration.cli.js')
  )
  const client = new MongoClient(DATABASE_URL)
  await client.connect()
  try {
    const reports = await runMigrationCli(client.db(), process.argv.slice(2))
    for (const report of reports) {
      console.log(JSON.stringify(report, null, 2))
    }
    if (reports.some(r => r.errors.length > 0)) process.exitCode = 1
  } finally {
    await client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
