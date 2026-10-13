/* eslint-disable no-console */
import * as dns from 'dns'

// Cùng cơ chế với seed-legal-knowledge.ts / main.ts: phân giải SRV của MongoDB Atlas.
const dnsServers = (process.env['NODE_DNS_SERVERS'] ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
if (dnsServers.length > 0) {
  dns.setServers(dnsServers)
  dns.promises.setServers(dnsServers)
}

import { NestFactory } from '@nestjs/core'
import { ObjectId } from 'mongodb'
import { DataSource } from 'typeorm'
import { AppModule } from '../app.module'
import { Apartment } from '../modules/properties/schemas/apartment.schema'
import { Contract } from '../modules/contracts/schemas/contract.schema'
import { RentalApplication } from '../modules/rental/schemas/rental-application.schema'

/**
 * Trả căn hộ về "Đang trống" bằng cách gỡ `rentalReservation` còn sót lại sau khi
 * hồ sơ thuê / hợp đồng đã bị xoá hoặc reset.
 *
 *   mặc định  : chỉ gỡ giữ chỗ "mồ côi" (hồ sơ hoặc hợp đồng tham chiếu không còn tồn tại)
 *   --all     : gỡ mọi giữ chỗ, kể cả khi hồ sơ/hợp đồng vẫn còn (reset hẳn dữ liệu demo)
 *   --apply   : thực sự ghi DB. Không có cờ này script chỉ in báo cáo (dry-run).
 *
 * Chạy: pnpm exec ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/reset-apartment-reservations.ts [--all] [--apply]
 */
function toObjectId(value: string | null | undefined): ObjectId | null {
  return value && ObjectId.isValid(value) ? new ObjectId(value) : null
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const all = process.argv.includes('--all')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  })
  try {
    const dataSource = app.get(DataSource)
    const apartments = dataSource.getMongoRepository(Apartment)
    const applications = dataSource.getMongoRepository(RentalApplication)
    const contracts = dataSource.getMongoRepository(Contract)

    const reserved = (await apartments.find()).filter(
      apartment => apartment.rentalReservation
    )
    console.log(`Căn hộ đang có giữ chỗ: ${reserved.length}`)

    const toReset: Apartment[] = []
    for (const apartment of reserved) {
      const reservation = apartment.rentalReservation
      if (!reservation) continue
      let reason: string | null = all ? 'reset toàn bộ (--all)' : null
      if (!reason) {
        const applicationId = toObjectId(reservation.applicationId)
        const application = applicationId
          ? await applications.findOne({ where: { _id: applicationId } })
          : null
        if (!application) {
          reason = 'hồ sơ thuê không còn tồn tại'
        } else if (reservation.contractId) {
          const contractId = toObjectId(reservation.contractId)
          const contract = contractId
            ? await contracts.findOne({ where: { _id: contractId } })
            : null
          if (!contract) reason = 'hợp đồng không còn tồn tại'
        }
      }
      if (reason) {
        toReset.push(apartment)
        console.log(
          `- ${apartment._id.toString()} "${apartment.title}" [${reservation.mode}]: ${reason}`
        )
      }
    }

    console.log(`Sẽ reset: ${toReset.length}/${reserved.length}`)
    if (!apply) {
      console.log('Dry-run: chưa ghi gì. Thêm --apply để thực hiện.')
      return
    }
    for (const apartment of toReset) {
      await apartments.updateOne(
        { _id: apartment._id },
        { $set: { rentalReservation: null } }
      )
    }
    console.log(`Đã reset ${toReset.length} căn hộ về trạng thái trống.`)
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
