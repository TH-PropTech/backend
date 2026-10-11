import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import { MockWallet } from '../mock-bank/schemas/mock-wallet.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { User } from '../users/schemas/user.schema'
import type { LinkWalletDto } from './dto/wallet.dto'
import {
  SUPPORTED_BANKS,
  findBank,
  maskAccountNumber,
  normalizeHolderName,
} from './supported-banks'
import {
  WalletTransaction,
  type WalletTransactionType,
} from './schemas/wallet-transaction.schema'

const DUPLICATE_KEY_CODE = 11000
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const PAYABLE_INVOICE_STATUSES = ['unpaid', 'overdue']

export type WalletView = {
  userId: string
  status: 'linked' | 'unlinked'
  simulation: boolean
  bank: { code: string; name: string } | null
  accountHolder: string | null
  accountNumberMasked: string | null
  balance: number
  totalReceived: number
  totalFeesPaid: number
  linkedAt: Date | null
}

export type WalletLinkResult = { wallet: WalletView; newlyLinked: boolean }

export type WalletTransactionPage = {
  items: WalletTransaction[]
  total: number
  page: number
  limit: number
}

export type PayableInvoice = {
  paymentId: string
  contractId: string
  amount: number
  vatAmount: number
  description: string
  dueDate: Date
  status: string
}

type LedgerEntry = {
  type: WalletTransactionType
  amount: number
  refType: string
  refId: string
  contractId?: string | null
  description: string
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name)

  constructor(
    @InjectRepository(MockWallet)
    private readonly walletRepository: MongoRepository<MockWallet>,
    @InjectRepository(WalletTransaction)
    private readonly transactionRepository: MongoRepository<WalletTransaction>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepository: MongoRepository<Payment>
  ) {}

  listBanks(): ReadonlyArray<{ code: string; name: string }> {
    return SUPPORTED_BANKS
  }

  async getMine(userId: string): Promise<WalletView> {
    const wallet = await this.walletRepository.findOne({ where: { userId } })
    return wallet ? this.toView(wallet) : this.unlinkedView(userId)
  }

  /** Liên kết (hoặc đổi) tài khoản ngân hàng; giữ nguyên số dư khi liên kết lại. */
  async link(userId: string, dto: LinkWalletDto): Promise<WalletLinkResult> {
    const bank = findBank(dto.bankCode)
    if (!bank) throw new BadRequestException('WALLET_BANK_NOT_SUPPORTED')
    await this.assertHolderMatchesProfile(userId, dto.accountHolder)
    const bankFields = {
      bankCode: bank.code,
      bankName: bank.name,
      accountHolder: normalizeHolderName(dto.accountHolder),
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
    }
    const existing = await this.walletRepository.findOne({ where: { userId } })
    if (existing) {
      Object.assign(existing, bankFields, { status: 'linked' as const })
      existing.linkedAt = existing.linkedAt ?? new Date()
      const saved = await this.walletRepository.save(existing)
      return { wallet: this.toView(saved), newlyLinked: false }
    }
    const created = await this.createWallet(userId, bankFields)
    return { wallet: this.toView(created), newlyLinked: true }
  }

  /** Cộng tiền payout đã chuyển thành công; gọi lại cùng payout không cộng thêm. */
  async creditPayout(input: {
    userId: string
    payoutId: string
    amount: number
    contractId: string | null
    paymentId: string
  }): Promise<WalletTransaction> {
    return this.applyEntry(input.userId, 1, {
      type: 'payout-credit',
      amount: input.amount,
      refType: 'payout',
      refId: input.payoutId,
      contractId: input.contractId,
      description: `Nhận tiền thuê từ thanh toán ${input.paymentId}`,
    })
  }

  /** Trừ số dư để trả hóa đơn phí sàn; ném WALLET_INSUFFICIENT_BALANCE nếu không đủ. */
  async debitInvoice(input: {
    userId: string
    paymentId: string
    amount: number
    contractId: string | null
    description: string
  }): Promise<WalletTransaction> {
    return this.applyEntry(input.userId, -1, {
      type: 'platform-fee-debit',
      amount: input.amount,
      refType: 'platform-fee-invoice',
      refId: input.paymentId,
      contractId: input.contractId,
      description: input.description,
    })
  }

  /** Hoàn lại khoản đã trừ khi ghi nhận hóa đơn đã trả bị lỗi. */
  async refundInvoice(input: {
    userId: string
    paymentId: string
    amount: number
    contractId: string | null
  }): Promise<WalletTransaction> {
    // Giải phóng khóa của dòng trừ phí để lần thử trả sau vẫn trừ tiền được.
    await this.transactionRepository.updateOne(
      { refType: 'platform-fee-invoice', refId: input.paymentId },
      { $set: { refType: 'platform-fee-invoice-reversed' } }
    )
    return this.applyEntry(input.userId, 1, {
      type: 'platform-fee-refund',
      amount: input.amount,
      refType: 'platform-fee-refund',
      refId: `${input.paymentId}:${new ObjectId().toHexString()}`,
      contractId: input.contractId,
      description: 'Hoàn tiền: không ghi nhận được thanh toán hóa đơn phí sàn',
    })
  }

  async listTransactions(
    userId: string,
    page = 1,
    limit = DEFAULT_PAGE_SIZE
  ): Promise<WalletTransactionPage> {
    const safePage = Math.max(1, Math.floor(page) || 1)
    const safeLimit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.floor(limit) || DEFAULT_PAGE_SIZE)
    )
    const [items, total] = await this.transactionRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    })
    return { items, total, page: safePage, limit: safeLimit }
  }

  /** Hóa đơn phí sàn chủ nhà còn phải trả (có thể trả bằng số dư ví). */
  async listPayableInvoices(userId: string): Promise<PayableInvoice[]> {
    const invoices = await this.paymentRepository.find({
      where: {
        type: 'platform-fee',
        payerId: userId,
        payerRole: 'landlord',
        status: { $in: PAYABLE_INVOICE_STATUSES },
      } as never,
      order: { dueDate: 'ASC' },
    })
    return invoices.map(invoice => ({
      paymentId: invoice._id.toHexString(),
      contractId: invoice.contractId,
      amount: invoice.amount,
      vatAmount: invoice.vatAmount ?? 0,
      description: invoice.description,
      dueDate: invoice.dueDate,
      status: invoice.status,
    }))
  }

  /** Chủ tài khoản phải trùng họ tên trên hồ sơ để tránh nhận tiền hộ người khác. */
  private async assertHolderMatchesProfile(
    userId: string,
    accountHolder: string
  ): Promise<void> {
    if (!ObjectId.isValid(userId)) throw new NotFoundException('USER_NOT_FOUND')
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })
    if (!user) throw new NotFoundException('USER_NOT_FOUND')
    const expected = normalizeHolderName(user.fullName ?? '')
    if (!expected || expected !== normalizeHolderName(accountHolder)) {
      throw new BadRequestException('WALLET_HOLDER_NAME_MISMATCH')
    }
  }

  private async createWallet(
    userId: string,
    bankFields: Pick<
      MockWallet,
      'bankCode' | 'bankName' | 'accountHolder' | 'accountNumberMasked'
    >
  ): Promise<MockWallet> {
    try {
      return await this.walletRepository.save(
        this.walletRepository.create({
          userId,
          provider: 'mock-bank',
          externalAccountRef: `mock-account:${userId}`,
          status: 'linked',
          simulation: true,
          ...bankFields,
          balance: 0,
          totalReceived: 0,
          totalFeesPaid: 0,
          linkedAt: new Date(),
        })
      )
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY_CODE) throw error
      throw new ConflictException('WALLET_ALREADY_EXISTS')
    }
  }

  /**
   * Ghi một dòng sao kê rồi cập nhật số dư. Khóa duy nhất (refType, refId) chặn ghi trùng;
   * khi trừ tiền, điều kiện balance >= amount nằm trong cùng lệnh cập nhật nên không âm số dư.
   */
  private async applyEntry(
    userId: string,
    direction: 1 | -1,
    entry: LedgerEntry
  ): Promise<WalletTransaction> {
    if (!Number.isInteger(entry.amount) || entry.amount <= 0) {
      throw new BadRequestException('WALLET_AMOUNT_INVALID')
    }
    const duplicate = await this.findEntry(entry)
    if (duplicate) return duplicate
    const wallet = await this.moveBalance(userId, direction, entry)
    try {
      return await this.transactionRepository.save(
        this.transactionRepository.create({
          walletId: wallet._id.toHexString(),
          userId,
          type: entry.type,
          amount: entry.amount,
          balanceAfter: wallet.balance,
          refType: entry.refType,
          refId: entry.refId,
          contractId: entry.contractId ?? null,
          description: entry.description,
        })
      )
    } catch (error) {
      await this.rollbackBalance(userId, direction, entry)
      if ((error as { code?: number }).code === DUPLICATE_KEY_CODE) {
        const raced = await this.findEntry(entry)
        if (raced) return raced
      }
      throw error
    }
  }

  private findEntry(entry: LedgerEntry): Promise<WalletTransaction | null> {
    return this.transactionRepository.findOne({
      where: { refType: entry.refType, refId: entry.refId },
    })
  }

  private async moveBalance(
    userId: string,
    direction: 1 | -1,
    entry: LedgerEntry
  ): Promise<MockWallet> {
    const signed = direction * entry.amount
    const filter =
      direction === -1
        ? { userId, status: 'linked', balance: { $gte: entry.amount } }
        : { userId, status: 'linked' }
    const counters = this.counterIncrement(entry)
    const updated = (await this.walletRepository.findOneAndUpdate(
      filter,
      { $inc: { balance: signed, ...counters } },
      { returnDocument: 'after' }
    )) as MockWallet | null
    if (updated) return updated
    return this.explainMissingWallet(userId, direction)
  }

  private counterIncrement(entry: LedgerEntry): Record<string, number> {
    if (entry.type === 'payout-credit') return { totalReceived: entry.amount }
    if (entry.type === 'platform-fee-debit') {
      return { totalFeesPaid: entry.amount }
    }
    return { totalFeesPaid: -entry.amount }
  }

  private async explainMissingWallet(
    userId: string,
    direction: 1 | -1
  ): Promise<never> {
    const wallet = await this.walletRepository.findOne({ where: { userId } })
    if (!wallet || wallet.status !== 'linked') {
      throw new NotFoundException('WALLET_NOT_LINKED')
    }
    if (direction === -1)
      throw new ConflictException('WALLET_INSUFFICIENT_BALANCE')
    throw new ConflictException('WALLET_UPDATE_FAILED')
  }

  private async rollbackBalance(
    userId: string,
    direction: 1 | -1,
    entry: LedgerEntry
  ): Promise<void> {
    const counters = Object.fromEntries(
      Object.entries(this.counterIncrement(entry)).map(([key, value]) => [
        key,
        -value,
      ])
    )
    try {
      await this.walletRepository.updateOne(
        { userId },
        { $inc: { balance: -direction * entry.amount, ...counters } }
      )
    } catch (error) {
      this.logger.error(
        `Wallet rollback failed for ${entry.refType}:${entry.refId}: ${error instanceof Error ? error.message : 'unknown'}`
      )
    }
  }

  private toView(wallet: MockWallet): WalletView {
    return {
      userId: wallet.userId,
      status: wallet.status,
      simulation: wallet.simulation,
      bank: wallet.bankCode
        ? { code: wallet.bankCode, name: wallet.bankName ?? wallet.bankCode }
        : null,
      accountHolder: wallet.accountHolder ?? null,
      accountNumberMasked: wallet.accountNumberMasked ?? null,
      balance: wallet.balance ?? 0,
      totalReceived: wallet.totalReceived ?? 0,
      totalFeesPaid: wallet.totalFeesPaid ?? 0,
      linkedAt: wallet.linkedAt ?? null,
    }
  }

  private unlinkedView(userId: string): WalletView {
    return {
      userId,
      status: 'unlinked',
      simulation: true,
      bank: null,
      accountHolder: null,
      accountNumberMasked: null,
      balance: 0,
      totalReceived: 0,
      totalFeesPaid: 0,
      linkedAt: null,
    }
  }
}
