/**
 * migrate-legacy-pricing.js
 * Convert tất cả apartment legacy sang packages pricing mode.
 * Chạy: node scripts/migrate-legacy-pricing.js
 *
 * Mỗi căn hộ sẽ nhận 3 gói: 1 tháng, 3 tháng (giảm 3%), 6 tháng (giảm 5%)
 */

'use strict'

const { MongoClient } = require('mongodb')

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'mongodb+srv://admin:22102004@cluster0.fh2rx8k.mongodb.net/th_proptech?retryWrites=true&w=majority&appName=Cluster0'

const COLLECTION = 'apartments'

function buildPackages(priceMonthly) {
  const base = Math.round(priceMonthly)
  const price3m = Math.round(base * 0.97)
  const price6m = Math.round(base * 0.95)

  return [
    {
      packageId: `pkg-1m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      version: 1,
      durationMonths: 1,
      monthlyRent: base,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      resolvedDepositAmount: base * 2,
      status: 'active',
      capturedAt: new Date(),
    },
    {
      packageId: `pkg-3m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      version: 1,
      durationMonths: 3,
      monthlyRent: price3m,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      resolvedDepositAmount: price3m * 2,
      status: 'active',
      capturedAt: new Date(),
    },
    {
      packageId: `pkg-6m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      version: 1,
      durationMonths: 6,
      monthlyRent: price6m,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      resolvedDepositAmount: price6m * 2,
      status: 'active',
      capturedAt: new Date(),
    },
  ]
}

async function migrate() {
  const client = new MongoClient(DATABASE_URL)
  await client.connect()
  console.log('Connected to MongoDB')

  const db = client.db()
  const col = db.collection(COLLECTION)

  const legacyApts = await col
    .find({ pricingMode: { $ne: 'packages' } })
    .toArray()

  console.log(`Found ${legacyApts.length} legacy apartments to migrate`)

  let migrated = 0
  let skipped = 0

  for (const apt of legacyApts) {
    const price = apt.priceMonthly
    if (!price || price <= 0) {
      console.warn(`Skipping ${apt._id} -- invalid priceMonthly: ${price}`)
      skipped++
      continue
    }

    const packages = buildPackages(price)
    const representativeRent = Math.min(
      ...packages.filter(p => p.status === 'active').map(p => p.monthlyRent)
    )

    await col.updateOne(
      { _id: apt._id },
      {
        $set: {
          pricingMode: 'packages',
          pricingRevision: 1,
          rentalPackages: packages,
          priceMonthly: representativeRent,
          updatedAt: new Date(),
        },
      }
    )

    console.log(
      `  OK ${apt._id} -- "${(apt.title || '').slice(0, 40)}" -> packages (${price} VND/m)`
    )
    migrated++
  }

  console.log(`Done: ${migrated} migrated, ${skipped} skipped`)
  await client.close()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
