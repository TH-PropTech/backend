import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { NotificationsService } from '../../notifications/notifications.service'
import { ContractViewService } from '../contract-view.service'
import type { ContractFlowStageDto } from '../dto/contract-view.dto'
import { Contract } from '../schemas/contract.schema'

const NOTIFIED_STATES: ReadonlySet<ContractFlowStageDto['status']> = new Set([
  'done',
  'blocked',
])

const DONE_TITLES: Record<ContractFlowStageDto['key'], string> = {
  document: 'Đã hoàn tất bước tài liệu hợp đồng',
  deposit: 'Đã xác nhận cọc',
  signing: 'Hai bên đã ký hợp đồng',
  ledger: 'Hợp đồng đã được ghi sổ cái',
  'move-in': 'Đã hoàn tất nhận nhà',
}

/** Chủ thể nội bộ đọc view ở chế độ staff; không phải participant. */
const SYSTEM_ACTOR_ID = 'system'

/**
 * Gửi thông báo in-app khi một stage của luồng hợp đồng chuyển sang `done`
 * hoặc `blocked` (spec rental-flow-state-projection). Chống trùng bằng khóa
 * `flow:<contractId>:<stage>:<state>` nên gọi lặp sau mỗi transition là an
 * toàn. Lỗi thông báo không bao giờ làm hỏng transition đã commit.
 */
@Injectable()
export class FlowNotificationService {
  private readonly logger = new Logger(FlowNotificationService.name)

  constructor(
    private readonly contractViewService: ContractViewService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>
  ) {}

  async notifyForDepositAgreement(agreementId: string): Promise<void> {
    try {
      const contract = await this.contractRepository.findOne({
        where: { depositAgreementId: agreementId },
      })
      if (contract) await this.notifyStages(contract._id.toHexString())
    } catch (error) {
      this.logFailure(`deposit-agreement:${agreementId}`, error)
    }
  }

  async notifyForContract(contractId: string): Promise<void> {
    try {
      await this.notifyStages(contractId)
    } catch (error) {
      this.logFailure(`contract:${contractId}`, error)
    }
  }

  private async notifyStages(contractId: string): Promise<void> {
    const view = await this.contractViewService.getForActor(
      contractId,
      SYSTEM_ACTOR_ID,
      true
    )
    const recipients = [view.parties.tenant.id, view.parties.landlord.id]
    const stages = (view.flow?.stages ?? []).filter(stage =>
      NOTIFIED_STATES.has(stage.status)
    )
    for (const stage of stages) {
      for (const userId of recipients.filter(Boolean)) {
        await this.notificationsService.createNotificationOnce(
          userId,
          `flow:${contractId}:${stage.key}:${stage.status}`,
          stage.status === 'done'
            ? DONE_TITLES[stage.key]
            : 'Hợp đồng cần xử lý',
          this.describe(stage),
          'contract-flow',
          { contractId, stage: stage.key, state: stage.status }
        )
      }
    }
  }

  private describe(stage: ContractFlowStageDto): string {
    if (stage.status === 'done') return DONE_TITLES[stage.key]
    const codes = stage.blockers.map(item => item.code).join(', ')
    return `Bước ${stage.key} đang bị chặn${codes ? `: ${codes}` : ''}.`
  }

  private logFailure(reference: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
    this.logger.warn(`FLOW_NOTIFICATION_FAILED ${reference}: ${message}`)
  }
}
