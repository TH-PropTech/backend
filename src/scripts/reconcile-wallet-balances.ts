/* eslint-disable no-console */
import { NestFactory } from '@nestjs/core'
import { getRepositoryToken } from '@nestjs/typeorm'
import type { MongoRepository } from 'typeorm'
import { AppModule } from '../app.module'
import { Wallet } from '../modules/wallets/schemas/wallet.schema'

export interface WalletBalanceRow {
  userId: string
  balance: number
  totalReceived: number
  totalFeesPaid: number
}

export interface ReconcileResult {
  rows: WalletBalanceRow[]
  totalBalance: number
  count: number
}

/**
 * Chỉ ĐỌC collection `mock_bank_wallets`: liệt kê ví còn `balance > 0` và tổng số dư.
 * KHÔNG được gọi save/update/delete ở đây dưới bất kỳ hình thức nào — xem
 * `openspec/changes/non-custodial-wallets/design.md` (D6) và unit test
 * `reconcile-wallet-balances.spec.ts` xác nhận bất biến này.
 *
 * Nhóm 4 đã xóa `balance`/`totalReceived`/`totalFeesPaid` khỏi entity
 * `Wallet` (task 4.2, D2/D4) vì không còn code nào ghi các trường này nữa.
 * Script này vẫn đọc document Mongo thô qua `Record<string, number>` vì
 * dữ liệu lịch sử trong `mock_bank_wallets` có thể còn các trường trên
 * (không bị xóa khỏi DB, chỉ không còn khai báo trong entity) — xác nhận
 * đã chạy một lần trên DB thật, kết quả 0 ví có balance > 0 (xem
 * `reconcile-report.md`), nên script giữ nguyên để tái dùng nếu cần đối
 * soát lại sau này.
 */
type LegacyWalletBalanceFields = {
  userId: string
  balance?: number
  totalReceived?: number
  totalFeesPaid?: number
}

export async function reconcileWalletBalances(
  walletRepository: Pick<MongoRepository<Wallet>, 'find'>
): Promise<ReconcileResult> {
  const wallets = await walletRepository.find({
    where: { balance: { $gt: 0 } } as never,
  })
  const rows: WalletBalanceRow[] = (
    wallets as unknown as LegacyWalletBalanceFields[]
  ).map(wallet => ({
    userId: wallet.userId,
    balance: wallet.balance ?? 0,
    totalReceived: wallet.totalReceived ?? 0,
    totalFeesPaid: wallet.totalFeesPaid ?? 0,
  }))
  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0)
  return { rows, count: rows.length, totalBalance }
}

function printReport(result: ReconcileResult, dry: boolean): void {
  console.log(
    `[${dry ? 'dry' : 'reconcile'}] Ví còn balance > 0 trong mock_bank_wallets: ${result.count}`
  )
  for (const row of result.rows) {
    console.log(
      `  userId=${row.userId} balance=${row.balance} totalReceived=${row.totalReceived} totalFeesPaid=${row.totalFeesPaid}`
    )
  }
  console.log(`Tổng số dư tồn: ${result.totalBalance}`)
}

async function bootstrap(dry: boolean): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  try {
    const walletRepository = app.get<MongoRepository<Wallet>>(
      getRepositoryToken(Wallet)
    )
    const result = await reconcileWalletBalances(walletRepository)
    printReport(result, dry)
  } finally {
    await app.close()
  }
}

if (require.main === module) {
  // Mặc định luôn là --dry: script này chỉ đọc, không có chế độ ghi.
  const dry = !process.argv.includes('--no-dry')
  bootstrap(dry).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
