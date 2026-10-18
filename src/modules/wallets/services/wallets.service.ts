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
import { Payment } from '../../payments/schemas/payment.schema'
import { User } from '../../users/schemas/user.schema'
import type { LinkWalletDto } from '../dto/wallet.dto'
import {
  MOCBANK_ACCOUNT_PATTERN,
  MOCBANK_BANK_CODE,
  SUPPORTED_BANKS,
  findBank,
  maskAccountNumber,
  normalizeHolderName,
} from '../utils/supported-banks'
import { Payout } from '../schemas/payout.schema'
import { Wallet } from '../schemas/wallet.schema'

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
  linkedAt: Date | null
}

export type WalletLinkResult = { wallet: WalletView; newlyLinked: boolean }

export type LandlordWalletItem = {
  userId: string
  name: string
  email: string
  wallet: WalletView
}

export type LandlordWalletPage = {
  items: LandlordWalletItem[]
  total: number
  page: number
  limit: number
}

/** Một dòng sao kê dựng từ Payout/Payment (D5); không có balanceAfter, không phải sổ cái. */
export type WalletStatementItem = {
  type: 'payout' | 'platform-fee'
  amount: number
  refType: string
  refId: string
  contractId: string | null
  description: string
  createdAt: Date
}

export type WalletTransactionPage = {
  items: WalletStatementItem[]
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

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name)

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: MongoRepository<Wallet>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepository: MongoRepository<Payment>,
    @InjectRepository(Payout)
    private readonly payoutRepository: MongoRepository<Payout>
  ) {}

  listBanks(): ReadonlyArray<{ code: string; name: string }> {
    return SUPPORTED_BANKS
  }

  /** Staff/admin observability: every landlord plus their payout-wallet link status. */
  async listLandlordWallets(
    page = 1,
    limit = DEFAULT_PAGE_SIZE
  ): Promise<LandlordWalletPage> {
    const safePage = Math.max(1, page || 1)
    const safeLimit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, limit || DEFAULT_PAGE_SIZE)
    )
    const [landlords, total] = await this.userRepository.findAndCount({
      where: { role: 'landlord' },
      order: { fullName: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    })
    const ids = landlords.map(l => String(l._id))
    const wallets = ids.length
      ? await this.walletRepository.find({ where: { userId: { $in: ids } } })
      : []
    const items = landlords.map(landlord => {
      const wallet = wallets.find(w => w.userId === String(landlord._id))
      return {
        userId: String(landlord._id),
        name: landlord.fullName,
        email: landlord.email,
        wallet: wallet
          ? this.toView(wallet)
          : this.unlinkedView(String(landlord._id)),
      }
    })
    return { items, total, page: safePage, limit: safeLimit }
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
    const isMocbank = bank.code === MOCBANK_BANK_CODE
    if (isMocbank && !MOCBANK_ACCOUNT_PATTERN.test(dto.accountNumber)) {
      throw new BadRequestException('ACCOUNT_NUMBER_INVALID')
    }
    const bankFields = {
      bankCode: bank.code,
      bankName: bank.name,
      accountHolder: normalizeHolderName(dto.accountHolder),
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
      // Chỉ tài khoản Ví Mộc mới giữ số đầy đủ (làm tài khoản nhận trực tiếp).
      mocbankAccountNumber: isMocbank ? dto.accountNumber : null,
      provider: isMocbank ? ('mocbank' as const) : ('mock-bank' as const),
      externalAccountRef: `${isMocbank ? 'mocbank' : 'mock-account'}:${userId}`,
      simulation: !isMocbank,
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

  /**
   * Sao kê (D5): dựng từ `Payout` đã `paid-out` + `Payment` loại
   * `platform-fee` đã `paid`, không còn đọc/ghi sổ cái `wallet_transactions`
   * (đã ngừng theo D6). Mỗi nguồn được truy vấn lấy tối đa `page * limit`
   * bản ghi mới nhất rồi trộn và cắt trang trong bộ nhớ — đủ cho quy mô
   * hiện tại (xem design.md D5 "Risks"); nếu dữ liệu lớn hơn sẽ cần
   * chuyển sang aggregation theo `createdAt` thay vì lấy-rồi-trộn.
   */
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
    const take = safePage * safeLimit

    const [payouts, invoices] = await Promise.all([
      this.payoutRepository.find({
        where: { landlordId: userId, status: 'paid-out' },
        order: { paidOutAt: 'DESC' },
        take,
      }),
      this.paymentRepository.find({
        where: {
          type: 'platform-fee',
          payerId: userId,
          payerRole: 'landlord',
          status: 'paid',
        } as never,
        order: { paidAt: 'DESC' },
        take,
      }),
    ])

    const payoutItems: WalletStatementItem[] = payouts.map(payout => ({
      type: 'payout',
      amount: payout.receivedAmount,
      refType: 'payout',
      refId: payout._id.toHexString(),
      contractId: payout.contractId,
      description: 'Tiền thuê đã chuyển về tài khoản ngân hàng liên kết',
      createdAt: payout.paidOutAt ?? payout.updatedAt,
    }))
    const invoiceItems: WalletStatementItem[] = invoices.map(invoice => ({
      type: 'platform-fee',
      amount: invoice.amount,
      refType: 'payment',
      refId: invoice._id.toHexString(),
      contractId: invoice.contractId,
      description: invoice.description,
      createdAt: invoice.paidAt ?? invoice.updatedAt,
    }))

    const merged = [...payoutItems, ...invoiceItems].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )
    const start = (safePage - 1) * safeLimit
    return {
      items: merged.slice(start, start + safeLimit),
      total: merged.length,
      page: safePage,
      limit: safeLimit,
    }
  }

  /** Tài khoản Ví Mộc nhận tiền trực tiếp của chủ nhà; null khi chưa liên kết. */
  async getMocbankAccountNumber(userId: string): Promise<string | null> {
    const wallet = await this.walletRepository.findOne({
      where: { userId, status: 'linked', provider: 'mocbank' },
    })
    return wallet?.mocbankAccountNumber ?? null
  }

  /** Hóa đơn phí sàn chủ nhà còn phải trả qua cổng thanh toán (`POST /bank/invoice/init`). */
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
      Wallet,
      | 'bankCode'
      | 'bankName'
      | 'accountHolder'
      | 'accountNumberMasked'
      | 'mocbankAccountNumber'
      | 'provider'
      | 'externalAccountRef'
      | 'simulation'
    >
  ): Promise<Wallet> {
    try {
      return await this.walletRepository.save(
        this.walletRepository.create({
          userId,
          status: 'linked',
          ...bankFields,
          linkedAt: new Date(),
        })
      )
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY_CODE) throw error
      throw new ConflictException('WALLET_ALREADY_EXISTS')
    }
  }

  private toView(wallet: Wallet): WalletView {
    return {
      userId: wallet.userId,
      status: wallet.status,
      simulation: wallet.simulation,
      bank: wallet.bankCode
        ? { code: wallet.bankCode, name: wallet.bankName ?? wallet.bankCode }
        : null,
      accountHolder: wallet.accountHolder ?? null,
      accountNumberMasked: wallet.accountNumberMasked ?? null,
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
      linkedAt: null,
    }
  }
}
