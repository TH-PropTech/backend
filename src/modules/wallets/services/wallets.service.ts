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
import { Apartment } from '../../properties/schemas/apartment.schema'
import { User } from '../../users/schemas/user.schema'
import type { LinkWalletDto } from '../dto/wallet.dto'
import {
  MOCBANK_BANK_CODE,
  type WalletBrand,
  maskAccountNumber,
  normalizeHolderName,
} from '../utils/supported-banks'
import { Payout, type PayoutStatus } from '../schemas/payout.schema'
import { humanizePayoutReason } from '../utils/payout-reason'
import { Wallet, type WalletExtraAccount } from '../schemas/wallet.schema'
import {
  MocbankAccountLookupClient,
  MocbankAccountLookupError,
} from './mocbank-account-lookup.client'

const DUPLICATE_KEY_CODE = 11000
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const PAYABLE_INVOICE_STATUSES = ['unpaid', 'overdue']
const RECEIVING_CACHE_TTL_MS = 2 * 60 * 1000
const RECEIVING_CACHE_MAX_USERS = 500
const RECEIVING_CHECK_TIMEOUT_MS = 4000
const RECEIVING_ISSUES_LIMIT = 20

export type WalletView = {
  userId: string
  status: 'linked' | 'unlinked'
  simulation: boolean
  bank: { code: string; name: string } | null
  accountHolder: string | null
  accountNumberMasked: string | null
  /** Full Ví Mộc account number, for the owner's own QR/receive-money display only. */
  accountNumber: string | null
  linkedAt: Date | null
  /** Ví mô phỏng phụ (Momo/ZaloPay) trên cùng tài khoản Ví Mộc. */
  extraAccounts: WalletExtraAccountView[]
}

export type WalletExtraAccountView = {
  brand: WalletBrand
  accountHolder: string
  accountNumberMasked: string
  /** Chỉ trả cho chủ ví (cùng quy tắc với ví chính). */
  accountNumber?: string
  linkedAt: string | null
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

export type ReceivingAccountState =
  | 'active'
  | 'not_found'
  | 'unreachable'
  | 'brand_mismatch'

export type ReceivingAccount = {
  brand: WalletBrand
  accountNumberMasked: string
  accountHolder: string | null
  state: ReceivingAccountState
  message: string
}

export type ReceivingIssue = {
  payoutId: string
  contractId: string | null
  amount: number
  status: 'awaiting-wallet' | 'pending' | 'failed'
  reasonCode: string | null
  reason: string
  createdAt: string
  reportedAt: string | null
}

export type ReceivingStatus = {
  checkedAt: string
  hasLinkedWallet: boolean
  accounts: ReceivingAccount[]
  lastReceived: {
    payoutId: string
    contractId: string | null
    amount: number
    paidOutAt: string
    reference: string | null
  } | null
  counts: { awaitingWallet: number; pending: number; failed: number }
  issues: ReceivingIssue[]
}

const RECEIVING_MESSAGES: Record<ReceivingAccountState, string> = {
  active: 'Ví đang hoạt động',
  not_found: 'Không tìm thấy ví hoặc ví đã bị khóa',
  unreachable: 'Không kết nối được tới Ví Mộc, thử lại sau',
  brand_mismatch: 'Số tài khoản không còn thuộc loại ví đã liên kết',
}

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name)
  private readonly receivingCache = new Map<
    string,
    { expiresAt: number; checkedAt: string; accounts: ReceivingAccount[] }
  >()

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: MongoRepository<Wallet>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>,
    @InjectRepository(Payment)
    private readonly paymentRepository: MongoRepository<Payment>,
    @InjectRepository(Payout)
    private readonly payoutRepository: MongoRepository<Payout>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: MongoRepository<Apartment>,
    private readonly mocbankAccountLookupClient: MocbankAccountLookupClient
  ) {}

  /**
   * Staff/admin observability: every user who owns at least one apartment
   * listing (the real "landlord" set — `User.role` is not authoritative,
   * any role can own listings) plus their payout-wallet link status.
   */
  async listLandlordWallets(
    page = 1,
    limit = DEFAULT_PAGE_SIZE
  ): Promise<LandlordWalletPage> {
    const safePage = Math.max(1, page || 1)
    const safeLimit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, limit || DEFAULT_PAGE_SIZE)
    )
    const [countFacet] = (await this.apartmentRepository
      .aggregate([{ $group: { _id: '$landlordId' } }, { $count: 'n' }])
      .toArray()) as Array<{ n: number }>
    const total = countFacet?.n ?? 0
    const ownerIdRows = (await this.apartmentRepository
      .aggregate([
        { $group: { _id: '$landlordId' } },
        { $sort: { _id: 1 } },
        { $skip: (safePage - 1) * safeLimit },
        { $limit: safeLimit },
      ])
      .toArray()) as Array<{ _id: string }>
    const ids = ownerIdRows.map(row => row._id).filter(Boolean)
    const [landlords, wallets] = await Promise.all([
      ids.length
        ? this.userRepository.find({
            where: { _id: { $in: ids.map(id => new ObjectId(id)) } },
          })
        : Promise.resolve([]),
      ids.length
        ? this.walletRepository.find({ where: { userId: { $in: ids } } })
        : Promise.resolve([]),
    ])
    const items = ids.map(id => {
      const landlord = landlords.find(u => String(u._id) === id)
      return {
        userId: id,
        name: landlord?.fullName ?? '(không rõ)',
        email: landlord?.email ?? '',
        wallet: wallets.find(w => w.userId === id)
          ? this.toView(wallets.find(w => w.userId === id)!)
          : this.unlinkedView(id),
      }
    })
    return { items, total, page: safePage, limit: safeLimit }
  }

  async getMine(userId: string): Promise<WalletView> {
    const wallet = await this.walletRepository.findOne({ where: { userId } })
    return wallet ? this.toView(wallet, true) : this.unlinkedView(userId)
  }

  /**
   * Liên kết (hoặc đổi) ví Ví Mộc; tra cứu tên chủ ví thật qua Mộc Bank thay
   * vì cho gõ tay (xác nhận ví có thật), giữ nguyên số dư khi liên kết lại.
   * Không yêu cầu tên chủ ví trùng hồ sơ — chủ nhà có thể nhận hộ.
   */
  async link(userId: string, dto: LinkWalletDto): Promise<WalletLinkResult> {
    if (dto.brand && dto.brand !== 'mocbank') {
      return this.linkExtra(userId, dto.accountNumber, dto.brand)
    }
    const { accountName: accountHolder } = await this.resolveOrThrow(
      dto.accountNumber
    )
    const bankFields = {
      bankCode: MOCBANK_BANK_CODE,
      bankName: 'Ví Mộc',
      accountHolder: normalizeHolderName(accountHolder),
      accountNumberMasked: maskAccountNumber(dto.accountNumber),
      mocbankAccountNumber: dto.accountNumber,
      provider: 'mocbank' as const,
      externalAccountRef: `mocbank:${userId}`,
      simulation: false,
    }
    const existing = await this.walletRepository.findOne({ where: { userId } })
    if (existing) {
      Object.assign(existing, bankFields, { status: 'linked' as const })
      existing.linkedAt = existing.linkedAt ?? new Date()
      const saved = await this.walletRepository.save(existing)
      return { wallet: this.toView(saved, true), newlyLinked: false }
    }
    const created = await this.createWallet(userId, bankFields)
    return { wallet: this.toView(created, true), newlyLinked: true }
  }

  private async resolveOrThrow(
    accountNumber: string
  ): Promise<{ accountName: string; brand: WalletBrand }> {
    try {
      return await this.mocbankAccountLookupClient.resolveAccount(accountNumber)
    } catch (error) {
      if (error instanceof MocbankAccountLookupError) {
        throw error.code === 'WALLET_NOT_FOUND'
          ? new NotFoundException('WALLET_NOT_FOUND')
          : new BadRequestException('MOCBANK_UNAVAILABLE')
      }
      throw error
    }
  }

  /** Liên kết ví mô phỏng phụ vào ví chính; thay mục cùng brand nếu đã có. */
  private async linkExtra(
    userId: string,
    accountNumber: string,
    brand: Exclude<WalletBrand, 'mocbank'>
  ): Promise<WalletLinkResult> {
    const primary = await this.walletRepository.findOne({ where: { userId } })
    if (!primary || primary.status !== 'linked') {
      throw new BadRequestException('PRIMARY_WALLET_REQUIRED')
    }
    const resolved = await this.resolveOrThrow(accountNumber)
    if (resolved.brand !== brand) {
      throw new BadRequestException('WALLET_BRAND_MISMATCH')
    }
    const current = primary.extraAccounts ?? []
    const previous = current.find(item => item.brand === brand)
    const entry: WalletExtraAccount = {
      brand,
      mocbankAccountNumber: accountNumber,
      accountHolder: normalizeHolderName(resolved.accountName),
      accountNumberMasked: maskAccountNumber(accountNumber),
      linkedAt: previous?.linkedAt ?? new Date(),
    }
    primary.extraAccounts = [
      ...current.filter(item => item.brand !== brand),
      entry,
    ]
    const saved = await this.walletRepository.save(primary)
    return { wallet: this.toView(saved, true), newlyLinked: false }
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

  /**
   * Trạng thái nhận tiền của chủ nhà: kiểm tra ví trực tiếp (cache theo user,
   * TTL 2 phút) + số liệu payout luôn đọc mới từ DB. Kiểm tra ví không bao
   * giờ ném lỗi ra ngoài.
   */
  async getReceivingStatus(
    userId: string,
    refresh = false
  ): Promise<ReceivingStatus> {
    const wallet = await this.walletRepository.findOne({ where: { userId } })
    const linked = wallet?.status === 'linked'
    const [live, payoutData] = await Promise.all([
      wallet && linked
        ? this.checkAccountsCached(userId, wallet, refresh)
        : null,
      this.loadReceivingPayouts(userId),
    ])
    return {
      checkedAt: live?.checkedAt ?? new Date().toISOString(),
      hasLinkedWallet: linked,
      accounts: live?.accounts ?? [],
      ...payoutData,
    }
  }

  private async checkAccountsCached(
    userId: string,
    wallet: Wallet,
    refresh: boolean
  ): Promise<{ checkedAt: string; accounts: ReceivingAccount[] }> {
    const now = Date.now()
    const hit = this.receivingCache.get(userId)
    if (!refresh && hit && hit.expiresAt > now) return hit
    const targets: Array<{
      brand: WalletBrand
      accountNumber: string | null | undefined
      masked: string
      holder: string | null
    }> = [
      {
        brand: 'mocbank',
        accountNumber: wallet.mocbankAccountNumber,
        masked: wallet.accountNumberMasked ?? '',
        holder: wallet.accountHolder ?? null,
      },
      ...(wallet.extraAccounts ?? []).map(item => ({
        brand: item.brand,
        accountNumber: item.mocbankAccountNumber,
        masked: item.accountNumberMasked,
        holder: item.accountHolder ?? null,
      })),
    ]
    const accounts = await Promise.all(
      targets.map(async (target): Promise<ReceivingAccount> => {
        const state = await this.checkAccountState(
          target.accountNumber,
          target.brand
        )
        return {
          brand: target.brand,
          accountNumberMasked: target.masked,
          accountHolder: target.holder,
          state,
          message: RECEIVING_MESSAGES[state],
        }
      })
    )
    const entry = {
      expiresAt: now + RECEIVING_CACHE_TTL_MS,
      checkedAt: new Date(now).toISOString(),
      accounts,
    }
    this.receivingCache.delete(userId)
    this.receivingCache.set(userId, entry)
    while (this.receivingCache.size > RECEIVING_CACHE_MAX_USERS) {
      const oldest = this.receivingCache.keys().next().value
      if (oldest === undefined) break
      this.receivingCache.delete(oldest)
    }
    return entry
  }

  private async checkAccountState(
    accountNumber: string | null | undefined,
    brand: WalletBrand
  ): Promise<ReceivingAccountState> {
    if (!accountNumber) return 'not_found'
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const resolved = await Promise.race([
        this.mocbankAccountLookupClient.resolveAccount(accountNumber),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('RECEIVING_CHECK_TIMEOUT')),
            RECEIVING_CHECK_TIMEOUT_MS
          )
        }),
      ])
      return resolved.brand === brand ? 'active' : 'brand_mismatch'
    } catch (error) {
      if (
        error instanceof MocbankAccountLookupError &&
        error.code === 'WALLET_NOT_FOUND'
      ) {
        return 'not_found'
      }
      this.logger.warn(
        `receiving check failed: ${(error as Error)?.message ?? String(error)}`
      )
      return 'unreachable'
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async loadReceivingPayouts(
    userId: string
  ): Promise<Pick<ReceivingStatus, 'lastReceived' | 'counts' | 'issues'>> {
    const problemStatuses: PayoutStatus[] = [
      'awaiting-wallet',
      'pending',
      'failed',
    ]
    const [lastPaid, problems] = await Promise.all([
      this.payoutRepository.find({
        where: { landlordId: userId, status: 'paid-out' },
        order: { paidOutAt: 'DESC' },
        take: 1,
      }),
      this.payoutRepository.find({
        where: {
          landlordId: userId,
          status: { $in: problemStatuses },
        } as never,
        order: { createdAt: 'DESC' },
      }),
    ])
    const last = lastPaid[0]
    const counts = { awaitingWallet: 0, pending: 0, failed: 0 }
    for (const payout of problems) {
      if (payout.status === 'awaiting-wallet') counts.awaitingWallet += 1
      else if (payout.status === 'pending') counts.pending += 1
      else if (payout.status === 'failed') counts.failed += 1
    }
    const issues: ReceivingIssue[] = [...problems]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, RECEIVING_ISSUES_LIMIT)
      .map(payout => {
        const reported = (payout as { reportedAt?: Date | null }).reportedAt
        return {
          payoutId: payout._id.toHexString(),
          contractId: payout.contractId ?? null,
          amount: payout.sentAmount,
          status: payout.status as ReceivingIssue['status'],
          reasonCode: payout.failureReason ?? null,
          reason: humanizePayoutReason(
            payout.status,
            payout.failureReason ?? null
          ),
          createdAt: payout.createdAt.toISOString(),
          reportedAt: reported ? new Date(reported).toISOString() : null,
        }
      })
    return {
      lastReceived: last
        ? {
            payoutId: last._id.toHexString(),
            contractId: last.contractId ?? null,
            amount: last.receivedAmount,
            paidOutAt: (last.paidOutAt ?? last.updatedAt).toISOString(),
            reference: last.relayRef ?? last.txRef ?? null,
          }
        : null,
      counts,
      issues,
    }
  }

  /** Tài khoản Ví Mộc nhận tiền trực tiếp của chủ nhà; null khi chưa liên kết. */
  async getMocbankAccountNumber(
    userId: string,
    brand: WalletBrand = 'mocbank'
  ): Promise<string | null> {
    const wallet = await this.walletRepository.findOne({
      where: { userId, status: 'linked', provider: 'mocbank' },
    })
    if (brand === 'mocbank') return wallet?.mocbankAccountNumber ?? null
    return (
      wallet?.extraAccounts?.find(item => item.brand === brand)
        ?.mocbankAccountNumber ?? null
    )
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

  /** `includeFullAccountNumber`: only for the wallet's own owner (QR/receive display), never for admin listings. */
  private toView(wallet: Wallet, includeFullAccountNumber = false): WalletView {
    return {
      userId: wallet.userId,
      status: wallet.status,
      simulation: wallet.simulation,
      bank: wallet.bankCode
        ? { code: wallet.bankCode, name: wallet.bankName ?? wallet.bankCode }
        : null,
      accountHolder: wallet.accountHolder ?? null,
      accountNumberMasked: wallet.accountNumberMasked ?? null,
      accountNumber:
        includeFullAccountNumber && wallet.provider === 'mocbank'
          ? (wallet.mocbankAccountNumber ?? null)
          : null,
      linkedAt: wallet.linkedAt ?? null,
      extraAccounts: (wallet.extraAccounts ?? []).map(item => ({
        brand: item.brand,
        accountHolder: item.accountHolder,
        accountNumberMasked: item.accountNumberMasked,
        ...(includeFullAccountNumber && wallet.provider === 'mocbank'
          ? { accountNumber: item.mocbankAccountNumber }
          : {}),
        linkedAt: item.linkedAt ? new Date(item.linkedAt).toISOString() : null,
      })),
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
      accountNumber: null,
      linkedAt: null,
      extraAccounts: [],
    }
  }
}
