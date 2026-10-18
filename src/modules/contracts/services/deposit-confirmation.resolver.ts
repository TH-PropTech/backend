import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import {
  DepositAgreement,
  DepositAgreementStatus,
} from '../schemas/deposit-agreement.schema'

/**
 * Nguồn dẫn tới kết luận "cọc đã xác nhận" của một hợp đồng.
 * - not-required: hợp đồng không yêu cầu cọc (deposit <= 0)
 * - agreement: kết luận từ trạng thái thỏa thuận cọc liên kết
 * - contract-field: kết luận từ `contract.depositPaidAt` khi không có
 *   thỏa thuận cọc đã xác nhận (đường kích hoạt hợp đồng cũ)
 */
export type DepositConfirmationSource =
  | 'not-required'
  | 'agreement'
  | 'contract-field'

export interface DepositConfirmationContractFacts {
  deposit: number
  depositPaidAt: Date | null
}

export interface DepositConfirmationAgreementFacts {
  id: string
  status: DepositAgreementStatus
  amount: number
  paidAt: Date | null
}

export interface DepositConfirmation {
  required: boolean
  requiredAmount: number
  confirmed: boolean
  source: DepositConfirmationSource
  agreementId: string | null
  agreementStatus: DepositAgreementStatus | null
  paidAt: Date | null
}

/**
 * Trạng thái thỏa thuận cọc coi là đã xác nhận đối với luồng kích hoạt/ký:
 * `paid` (đã trả), `applied-to-lease-security` (đã chuyển vào hợp đồng
 * thuê chính thức) và `released` (ký quỹ đã giải ngân cho chủ nhà). Đây là nguồn sự thật duy nhất dùng chung cho
 * `ContractsService`, `SmartCaSigningService` và `ContractViewService`
 * theo yêu cầu specs/rental-flow-state-projection.
 */
const CONFIRMED_AGREEMENT_STATUSES: ReadonlySet<DepositAgreementStatus> =
  new Set(['paid', 'applied-to-lease-security', 'released'])

/**
 * Hàm thuần tính "cọc đã xác nhận chưa" từ dữ kiện đã có sẵn (không truy vấn
 * DB). Dùng trực tiếp bởi mọi service đã tự có bản ghi hợp đồng/thỏa thuận
 * cọc, và dùng nội bộ bởi `DepositConfirmationResolver` cho nơi cần tự
 * truy vấn thỏa thuận cọc theo hợp đồng.
 */
export function resolveDepositConfirmation(
  contract: DepositConfirmationContractFacts,
  agreement: DepositConfirmationAgreementFacts | null
): DepositConfirmation {
  if (contract.deposit <= 0) {
    return {
      required: false,
      requiredAmount: 0,
      confirmed: true,
      source: 'not-required',
      agreementId: agreement?.id ?? null,
      agreementStatus: agreement?.status ?? null,
      paidAt: agreement?.paidAt ?? contract.depositPaidAt ?? null,
    }
  }

  if (agreement && CONFIRMED_AGREEMENT_STATUSES.has(agreement.status)) {
    return {
      required: true,
      requiredAmount: agreement.amount,
      confirmed: true,
      source: 'agreement',
      agreementId: agreement.id,
      agreementStatus: agreement.status,
      paidAt: agreement.paidAt ?? contract.depositPaidAt ?? null,
    }
  }

  if (contract.depositPaidAt) {
    return {
      required: true,
      requiredAmount: agreement?.amount ?? contract.deposit,
      confirmed: true,
      source: 'contract-field',
      agreementId: agreement?.id ?? null,
      agreementStatus: agreement?.status ?? null,
      paidAt: contract.depositPaidAt,
    }
  }

  return {
    required: true,
    requiredAmount: agreement?.amount ?? contract.deposit,
    confirmed: false,
    source: agreement ? 'agreement' : 'contract-field',
    agreementId: agreement?.id ?? null,
    agreementStatus: agreement?.status ?? null,
    paidAt: null,
  }
}

export interface DepositConfirmationResolvable {
  deposit: number
  depositPaidAt?: Date | null
  depositAgreementId?: string | null
  rentalApplicationId?: string | null
}

/**
 * Provider dùng chung để các consumer chỉ có `Contract` (không tự có sẵn
 * thỏa thuận cọc đã fetch) có thể hỏi "cọc đã xác nhận chưa" mà không tự
 * lặp lại logic tra cứu thỏa thuận cọc theo `depositAgreementId` rồi
 * `rentalApplicationId`.
 */
@Injectable()
export class DepositConfirmationResolver {
  constructor(
    @InjectRepository(DepositAgreement)
    private readonly depositAgreementRepository: Repository<DepositAgreement>
  ) {}

  async resolve(
    contract: DepositConfirmationResolvable
  ): Promise<DepositConfirmation> {
    const agreement = await this.findAgreement(contract)
    return resolveDepositConfirmation(
      {
        deposit: contract.deposit,
        depositPaidAt: contract.depositPaidAt ?? null,
      },
      agreement
        ? {
            id: agreement._id.toHexString(),
            status: agreement.status,
            amount: agreement.amount,
            paidAt: agreement.paidAt ?? null,
          }
        : null
    )
  }

  private async findAgreement(
    contract: DepositConfirmationResolvable
  ): Promise<DepositAgreement | null> {
    let agreement: DepositAgreement | null = null
    if (
      contract.depositAgreementId &&
      ObjectId.isValid(contract.depositAgreementId)
    ) {
      agreement = await this.depositAgreementRepository.findOne({
        where: { _id: new ObjectId(contract.depositAgreementId) },
      })
    }
    if (!agreement && contract.rentalApplicationId) {
      agreement = await this.depositAgreementRepository.findOne({
        where: { applicationId: contract.rentalApplicationId },
      })
    }
    return agreement
  }
}
