/**
 * remove-buildings.js
 * Bỏ khái niệm Tòa nhà: gỡ field buildingId/buildingName khỏi `apartments`
 * và đổi tên collection `buildings` -> `buildings_removed_backup` (không xóa dữ liệu).
 *
 * Dry-run (mặc định, không ghi):  DATABASE_URL=<uri> node scripts/remove-buildings.js
 * Áp dụng:                        DATABASE_URL=<uri> node scripts/remove-buildings.js --apply
 * Xóa hẳn bản sao lưu sau khi đã kiểm tra:
 *                                 DATABASE_URL=<uri> node scripts/remove-buildings.js --apply --drop-backup
 *
 * Khuyến nghị: mongodump trước khi --apply. Chạy lại nhiều lần an toàn (idempotent).
 */

'use strict'

const { MongoClient } = require('mongodb')

const DATABASE_URL = process.env.DATABASE_URL
const APPLY = process.argv.includes('--apply')
const DROP_BACKUP = process.argv.includes('--drop-backup')

const BACKUP = 'buildings_removed_backup'

if (!DATABASE_URL) {
  console.error(
    'Thiếu biến môi trường DATABASE_URL. Ví dụ: DATABASE_URL=<uri> node scripts/remove-buildings.js [--apply]'
  )
  process.exit(1)
}

async function collectionExists(db, name) {
  return (await db.listCollections({ name }).toArray()).length > 0
}

async function main() {
  const client = new MongoClient(DATABASE_URL)
  await client.connect()
  try {
    const db = client.db()
    console.log(APPLY ? '== APPLY ==' : '== DRY-RUN (thêm --apply để ghi) ==')

    const filter = {
      $or: [
        { buildingId: { $exists: true } },
        { buildingName: { $exists: true } },
      ],
    }
    const apartments = db.collection('apartments')
    const affected = await apartments.countDocuments(filter)
    console.log(`apartments có buildingId/buildingName: ${affected}`)
    if (APPLY && affected > 0) {
      const res = await apartments.updateMany(filter, {
        $unset: { buildingId: '', buildingName: '' },
      })
      console.log(`  đã gỡ field ở ${res.modifiedCount} căn hộ`)
    }

    if (await collectionExists(db, 'buildings')) {
      const n = await db.collection('buildings').countDocuments()
      console.log(`collection buildings: ${n} bản ghi`)
      if (APPLY) {
        if (await collectionExists(db, BACKUP)) {
          console.log(
            `  ${BACKUP} đã tồn tại, bỏ qua đổi tên (kiểm tra thủ công)`
          )
        } else {
          await db.collection('buildings').rename(BACKUP)
          console.log(`  đã đổi tên -> ${BACKUP}`)
        }
      }
    } else {
      console.log('collection buildings: không tồn tại')
    }

    if (DROP_BACKUP && (await collectionExists(db, BACKUP))) {
      console.log(`${BACKUP}: ${APPLY ? 'xóa' : 'sẽ xóa'}`)
      if (APPLY) await db.collection(BACKUP).drop()
    }
  } finally {
    await client.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
