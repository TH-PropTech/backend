import { Injectable, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { BlockchainLog } from './schemas/blockchain-log.schema'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'
import { ContractAuditEventDto } from '../contracts/dto/contract-audit-event.dto'

@Injectable()
export class LedgerAuditQueryService {
  constructor(
    @InjectRepository(BlockchainLog)
    private readonly logRepository: Repository<BlockchainLog>,
    @InjectRepository(LedgerOutbox)
    private readonly outboxRepository: Repository<LedgerOutbox>,
    @Optional() private readonly configService?: ConfigService
  ) {}

  /**
   * Truy vấn và tổng hợp danh sách sự kiện audit cho hợp đồng
   */
  async getContractEvents(
    contractId: string
  ): Promise<ContractAuditEventDto[]> {
    const [logs, outboxList] = await Promise.all([
      this.logRepository.find({
        where: { contractId },
        order: { createdAt: 'DESC' },
      }),
      this.outboxRepository.find({
        where: { aggregateId: contractId },
        order: { createdAt: 'DESC' },
      }),
    ])

    const events: ContractAuditEventDto[] = []

    // 1. Map từ Ledger Outbox (Trạng thái đẩy sổ cái)
    for (const outbox of outboxList) {
      const networkMode: 'simulation' | 'fabric' =
        outbox.networkMode ??
        (this.configService?.get<string>('FABRIC_ENABLED') === 'true'
          ? 'fabric'
          : 'simulation')
      events.push({
        id: `outbox-${outbox._id.toString()}`,
        category: 'ledger',
        eventType: outbox.eventType || 'ledger.sync',
        status: outbox.status,
        occurredAt: outbox.updatedAt
          ? outbox.updatedAt.toISOString()
          : outbox.createdAt.toISOString(),
        actorRole: 'system',
        networkMode,
        txHash: outbox.txHash ?? null,
        // Chỉ hiển thị số khối nếu là Fabric thật và có số khối hợp lệ > 0
        blockNumber:
          networkMode === 'fabric' &&
          outbox.blockNumber != null &&
          outbox.blockNumber > 0
            ? outbox.blockNumber
            : null,
        retryable: outbox.status === 'failed',
        displayCode: `LEDGER_${outbox.status.toUpperCase()}`,
        description: this.getOutboxDescription(outbox),
      })
    }

    // 2. Map từ Blockchain Logs
    for (const log of logs) {
      const isSim = log.networkMode === 'simulation'
      events.push({
        id: `log-${log._id.toString()}`,
        category: this.resolveCategory(log.eventType || log.action),
        eventType: log.eventType || log.action,
        status:
          (log.status as
            | 'pending'
            | 'processing'
            | 'confirmed'
            | 'failed'
            | 'informational') || 'confirmed',
        occurredAt: log.createdAt
          ? log.createdAt.toISOString()
          : new Date().toISOString(),
        actorRole: 'system',
        networkMode: log.networkMode || 'simulation',
        txHash: log.txHash || null,
        blockNumber:
          isSim || log.blockNumber == null || log.blockNumber <= 0
            ? null
            : log.blockNumber,

        retryable: log.status === 'failed',
        displayCode: `LOG_${(log.status || 'CONFIRMED').toUpperCase()}`,
        description: this.getLogDescription(log),
      })
    }

    // Sort ổn định theo thời gian giảm dần
    return events.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    )
  }

  private resolveCategory(
    action: string
  ): 'contract' | 'signature' | 'deposit' | 'payment' | 'ledger' {
    if (action.includes('deposit')) return 'deposit'
    if (action.includes('sign')) return 'signature'
    if (action.includes('pay')) return 'payment'
    if (action.includes('contract')) return 'contract'
    return 'ledger'
  }

  private getOutboxDescription(outbox: LedgerOutbox): string {
    switch (outbox.status) {
      case 'pending':
        return 'Giao dịch đang chờ hàng đợi xử lý ghi nhận lên sổ cái'
      case 'processing':
        return 'Hệ thống đang thực hiện đồng bộ dữ liệu vào mạng lưới Hyperledger Fabric'
      case 'confirmed':
        return 'Giao dịch đã được đồng bộ thành công vào sổ cái Blockchain'
      case 'failed':
        return 'Đồng bộ sổ cái tạm thời thất bại, đang trong hàng đợi tự động thử lại'
      default:
        return 'Đang theo dõi tiến trình đồng bộ sổ cái'
    }
  }

  private getLogDescription(log: BlockchainLog): string {
    const isSim = log.networkMode === 'simulation'
    const suffix = isSim ? ' (Chế độ mô phỏng)' : ''
    switch (log.action) {
      case 'createContract':
        return `Khởi tạo và neo mã băm hợp đồng trên sổ cái Fabric${suffix}`
      case 'recordDeposit':
        return `Ghi nhận xác nhận đặt cọc bảo đảm lên sổ cái${suffix}`
      case 'terminateContract':
        return `Ghi nhận thanh lý/chấm dứt hợp đồng trên sổ cái${suffix}`
      default:
        return `Giao dịch ${log.action} được ghi nhận trên sổ cái${suffix}`
    }
  }
}
