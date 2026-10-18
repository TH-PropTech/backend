/* eslint-disable no-console */
import * as dns from 'dns'

// Cùng cơ chế với reset-apartment-reservations.ts / main.ts: phân giải SRV của MongoDB Atlas.
const dnsServers = (process.env['NODE_DNS_SERVERS'] ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
if (dnsServers.length > 0) {
  dns.setServers(dnsServers)
  dns.promises.setServers(dnsServers)
}

import { NestFactory } from '@nestjs/core'
import { DataSource } from 'typeorm'
import { AppModule } from '../app.module'
import { Contract } from '../modules/contracts/schemas/contract.schema'
import { MoveInSettlementsService } from '../modules/rental/services/move-in-settlements.service'

/**
 * Backfill `MoveInSettlement` cho các hợp đồng `active` hiện có mà chưa có settlement
 * (ví dụ hợp đồng được kích hoạt trước khi guard `!policy && !tenantFee` bị bỏ).
 *
 *   mặc định  : chỉ in danh sách hợp đồng sẽ tạo settlement (dry-run)
 *   --apply   : thực sự gọi `createForContract` và ghi DB
 *
 * Idempotent: `createForContract` trả lại settlement đã có nếu `contract.settlementId`
 * hoặc một bản ghi settlement cho hợp đồng đã tồn tại, nên chạy lại nhiều lần an toàn.
 *
 * Chạy: pnpm exec ts-node -r tsconfig-paths/register -r dotenv/config src/scripts/backfill-move-in-settlements.ts [--apply]
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  })
  try {
    const dataSource = app.get(DataSource)
    const contracts = dataSource.getMongoRepository(Contract)
    const settlementsService = app.get(MoveInSettlementsService)

    const active = await contracts.find({ where: { status: 'active' } })
    const missing = active.filter(contract => !contract.settlementId)
    console.log(`Hợp đồng active: ${active.length}`)
    console.log(`Chưa có settlement: ${missing.length}`)
    for (const contract of missing) {
      console.log(
        `- ${contract._id.toHexString()} "${contract.contractCode}" (landlord=${contract.landlordId}, tenant=${contract.tenantId})`
      )
    }

    if (!apply) {
      console.log('Dry-run: chưa ghi gì. Thêm --apply để thực hiện.')
      return
    }

    let created = 0
    let skipped = 0
    for (const contract of missing) {
      const settlement = await settlementsService.createForContract(contract)
      if (settlement) created += 1
      else skipped += 1
    }
    console.log(
      `Đã tạo settlement cho ${created} hợp đồng; ${skipped} hợp đồng không có khoản nào cần thu (trả null).`
    )
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
