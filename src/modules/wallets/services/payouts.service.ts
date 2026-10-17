import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomBytes } from 'node:crypto'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import { NotificationsService } from '../../notifications/services/notifications.service'
import { Payout } from '../schemas/payout.schema'
import { Wallet } from '../schemas/wallet.schema'
import {
  MocbankPayoutClient,
  MocbankPayoutError,
} from './mocbank-payout.client'

export type PayoutSource = {
  paymentId: string
  contractId: string | null
  landlordId: string
  amount: number
  /** Có khi khách đã trả thẳng vào tài khoản chủ nhà; payout ghi `paid-out` ngay. */
  directReceipt?: { paidAt: Date } | undefined
}

export type PayoutOutcome = 'success' | 'failed'

export type PayoutSettleResult = { payout: Payout; replayed: boolean }

export type PayoutListResult = {
  items: Payout[]
  total: number
  page: number
  limit: number
}

const DUPLICATE_KEY_CODE = 11000

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name)

  constructor(
    @InjectRepository(Payout)
    private readonly payoutRepository: MongoRepository<Payout>,
    @InjectRepository(Wallet)
    private readonly walletRepository: MongoRepository<Wallet>,
    private readonly notificationsService: NotificationsService,
    @Optional()
    private readonly mocbankPayoutClient?: MocbankPayoutClient
  ) {}

  /** Tạo đúng một payout cho mỗi payment; gọi lại sẽ trả payout cũ. */
  async createForPayment(source: PayoutSource): Promise<Payout> {
    const existing = await this.payoutRepository.findOne({
      where: { paymentId: source.paymentId },
    })
    if (existing) return existing
    const payout = this.payoutRepository.create({
      paymentId: source.paymentId,
      contractId: source.contractId,
      landlordId: source.landlordId,
      walletId: null,
      txRef: null,
      sentAmount: source.amount,
      feeAmount: 0,
      receivedAmount: source.amount,
      status: 'awaiting-wallet',
      attempts: 1,
      failureReason: null,
      paidOutAt: null,
      directReceipt: false,
    })
    try {
      if (source.directReceipt) {
        return await this.recordDirectReceipt(
          payout,
          source.directReceipt.paidAt
        )
      }
      const saved = await this.payoutRepository.save(payout)
      return this.initiate(saved)
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY_CODE) throw error
      const raced = await this.payoutRepository.findOne({
        where: { paymentId: source.paymentId },
      })
      if (!raced) throw error
      return raced
    }
  }

  /** Chủ nhà vừa liên kết ví: chạy các payout đang chờ ví. */
  async releaseAwaitingWallet(landlordId: string): Promise<number> {
    const waiting = await this.payoutRepository.find({
      where: { landlordId, status: 'awaiting-wallet' },
    })
    for (const payout of waiting) await this.initiate(payout)
    return waiting.length
  }

  /** Kết quả chuyển tiền do chủ nhà chốt trên trang giả lập. */
  async settleForLandlord(
    txRef: string,
    outcome: PayoutOutcome,
    landlordId: string
  ): Promise<PayoutSettleResult> {
    const payout = await this.payoutRepository.findOne({ where: { txRef } })
    if (!payout || payout.landlordId !== landlordId) {
      throw new NotFoundException('PAYOUT_NOT_FOUND')
    }
    if (payout.directReceipt) {
      throw new ConflictException('PAYOUT_ALREADY_RECEIVED')
    }
    const wallet = payout.walletId ? await this.findWallet(payout) : null
    if (!wallet?.simulation) {
      throw new ForbiddenException('PAYOUT_SIMULATION_ONLY')
    }
    return this.settle(payout, outcome)
  }

  async retry(id: string): Promise<Payout> {
    const payout = await this.findById(id)
    if (payout.status !== 'failed') {
      throw new ConflictException('PAYOUT_NOT_RETRYABLE')
    }
    payout.attempts += 1
    payout.failureReason = null
    return this.initiate(payout)
  }

  async listForLandlord(
    landlordId: string,
    page = 1,
    limit = 20
  ): Promise<PayoutListResult> {
    const safePage = Math.max(1, Math.floor(page) || 1)
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20))
    const [items, total] = await this.payoutRepository.findAndCount({
      where: { landlordId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    })
    return { items, total, page: safePage, limit: safeLimit }
  }

  async getForLandlord(id: string, landlordId: string): Promise<Payout> {
    const payout = await this.findById(id)
    if (payout.landlordId !== landlordId) {
      throw new NotFoundException('PAYOUT_NOT_FOUND')
    }
    return payout
  }

  async getByTxRefForLandlord(
    txRef: string,
    landlordId: string
  ): Promise<Payout> {
    const payout = await this.payoutRepository.findOne({ where: { txRef } })
    if (!payout || payout.landlordId !== landlordId) {
      throw new NotFoundException('PAYOUT_NOT_FOUND')
    }
    return payout
  }

  /** Tiền đã vào tài khoản chủ nhà khi thanh toán được xác thực: ghi nhận, không chuyển gì thêm. */
  private async recordDirectReceipt(
    payout: Payout,
    paidAt: Date
  ): Promise<Payout> {
    const wallet = await this.walletRepository.findOne({
      where: { userId: payout.landlordId, status: 'linked' },
    })
    payout.walletId = wallet ? wallet._id.toHexString() : null
    payout.status = 'paid-out'
    payout.paidOutAt = paidAt
    payout.directReceipt = true
    const saved = await this.payoutRepository.save(payout)
    await this.notifyReceived(saved)
    return saved
  }

  /** Gắn ví + txRef mới rồi báo chủ nhà; không có ví thì giữ awaiting-wallet. */
  private async initiate(payout: Payout): Promise<Payout> {
    const wallet = await this.walletRepository.findOne({
      where: { userId: payout.landlordId, status: 'linked' },
    })
    if (!wallet) {
      payout.status = 'awaiting-wallet'
      return this.payoutRepository.save(payout)
    }
    payout.walletId = wallet._id.toHexString()
    payout.txRef = `PAYOUT-${randomBytes(12).toString('hex')}`
    payout.status = 'pending'
    const saved = await this.payoutRepository.save(payout)
    if (this.canRelayToMocbank(wallet))
      return this.relayToMocbank(saved, wallet)
    await this.notifyPending(saved)
    return saved
  }

  /** Ví Mộc Bank của chủ nhà: nền tảng chuyển hộ tự động (giả lập), không cần chủ nhà bấm. */
  private canRelayToMocbank(wallet: Wallet): boolean {
    return (
      wallet.provider === 'mocbank' &&
      Boolean(wallet.mocbankAccountNumber) &&
      Boolean(this.mocbankPayoutClient?.isConfigured())
    )
  }

  private async relayToMocbank(
    payout: Payout,
    wallet: Wallet
  ): Promise<Payout> {
    const client = this.mocbankPayoutClient
    if (!client || !wallet.mocbankAccountNumber) return payout
    try {
      const { transactionCode } = await client.payout({
        // Stable across retries, so Mộc Bank never pays the same payout twice.
        orderId: `PAYOUT-${payout._id.toHexString()}`,
        amount: payout.receivedAmount,
        payeeAccountNumber: wallet.mocbankAccountNumber,
        description: `Chuyển hộ tiền thuê ${payout.contractId ?? payout.paymentId}`,
      })
      payout.relayRef = transactionCode
      await this.payoutRepository.save(payout)
      return (await this.settle(payout, 'success')).payout
    } catch (error) {
      const reason =
        error instanceof MocbankPayoutError ? error.code : 'TRANSFER_FAILED'
      this.logger.warn(
        `Payout ${payout._id.toHexString()} relay failed: ${reason}`
      )
      payout.status = 'failed'
      payout.failureReason = reason
      return this.payoutRepository.save(payout)
    }
  }

  private async settle(
    payout: Payout,
    outcome: PayoutOutcome
  ): Promise<PayoutSettleResult> {
    if (payout.status !== 'pending') return { payout, replayed: true }
    const set =
      outcome === 'success'
        ? {
            status: 'paid-out' as const,
            paidOutAt: new Date(),
            failureReason: null,
          }
        : { status: 'failed' as const, failureReason: 'TRANSFER_FAILED' }
    // Chỉ một lần gọi thắng cuộc đua: điều kiện status = pending.
    const result = await this.payoutRepository.updateOne(
      { _id: payout._id, status: 'pending' },
      { $set: set }
    )
    const fresh = await this.findById(payout._id.toHexString())
    if (result.modifiedCount === 0) return { payout: fresh, replayed: true }
    // Chuyển tiền thành công chỉ ghi nhận trạng thái Payout (đã ở trên);
    // không còn cộng số dư ví nội bộ (xem design.md D3).
    if (outcome === 'success') await this.notifyReceived(fresh)
    return { payout: fresh, replayed: false }
  }

  private async findById(id: string): Promise<Payout> {
    if (!ObjectId.isValid(id)) throw new NotFoundException('PAYOUT_NOT_FOUND')
    const payout = await this.payoutRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!payout) throw new NotFoundException('PAYOUT_NOT_FOUND')
    return payout
  }

  private findWallet(payout: Payout): Promise<Wallet | null> {
    if (!payout.walletId || !ObjectId.isValid(payout.walletId)) {
      return Promise.resolve(null)
    }
    return this.walletRepository.findOne({
      where: { _id: new ObjectId(payout.walletId) },
    })
  }

  private async notifyPending(payout: Payout): Promise<void> {
    const id = payout._id.toHexString()
    await this.safeNotify(() =>
      this.notificationsService.createNotificationOnce(
        payout.landlordId,
        `payout:${id}:pending:${payout.attempts}`,
        'Có khoản tiền đang chờ nhận',
        `Khách đã thanh toán ${payout.receivedAmount.toLocaleString('vi-VN')} VND. Mở liên kết để xác nhận kết quả chuyển tiền về ví.`,
        'PAYOUT_PENDING',
        {
          payoutId: id,
          txRef: payout.txRef,
          amount: payout.receivedAmount,
          link: `/landlord/payouts/${payout.txRef}`,
        }
      )
    )
  }

  private async notifyReceived(payout: Payout): Promise<void> {
    const id = payout._id.toHexString()
    await this.safeNotify(() =>
      this.notificationsService.createNotificationOnce(
        payout.landlordId,
        `payout:${id}:received`,
        'Bạn đã nhận tiền',
        this.receivedMessage(payout),
        'PAYOUT_RECEIVED',
        {
          payoutId: id,
          contractId: payout.contractId,
          sentAmount: payout.sentAmount,
          receivedAmount: payout.receivedAmount,
          simulatedRelay: Boolean(payout.relayRef),
          transactionCode: payout.relayRef ?? null,
        }
      )
    )
  }

  private receivedMessage(payout: Payout): string {
    const amount = payout.receivedAmount.toLocaleString('vi-VN')
    if (payout.directReceipt) {
      return `Khách đã thanh toán trực tiếp ${amount} VND vào tài khoản Mộc Bank đã liên kết của bạn.`
    }
    if (payout.relayRef) {
      return `Khách đã thanh toán qua cổng của nền tảng. Nền tảng đã chuyển hộ ${amount} VND vào ví Mộc Bank của bạn (mã ${payout.relayRef}). Đây là chuyển hộ giả lập trên môi trường thử nghiệm: nền tảng nhận tiền rồi chuyển lại vào ví Mộc Bank.`
    }
    return `${amount} VND đã được chuyển về tài khoản ngân hàng đã liên kết của bạn (sàn chuyển ${payout.sentAmount.toLocaleString('vi-VN')} VND).`
  }

  /** Lỗi thông báo không được làm hỏng payout đã ghi. */
  private async safeNotify(send: () => Promise<unknown>): Promise<void> {
    try {
      await send()
    } catch (error) {
      this.logger.warn(
        `Payout notification failed: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }
}
