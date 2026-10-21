import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { FindOptionsWhere, Repository } from 'typeorm'
import { Booking } from '../../bookings/schemas/booking.schema'
import { Contract } from '../../contracts/schemas/contract.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { User } from '../../users/schemas/user.schema'

export const PERSONAL_TOOL_NAMES = [
  'get_my_bookings',
  'get_my_contracts',
  'get_my_payments',
  'get_my_kyc_status',
] as const
export type PersonalToolName = (typeof PERSONAL_TOOL_NAMES)[number]

export const LOGIN_REQUIRED_MESSAGE =
  'Khách chưa đăng nhập nên chưa thể tra cứu thông tin cá nhân. Hãy lịch sự mời khách đăng nhập rồi hỏi lại; không bịa dữ liệu.'

const MAX_ITEMS = 5
const TIME_ZONE = 'Asia/Ho_Chi_Minh'

const BOOKING_STATUS: Record<string, string> = {
  pending: 'chờ chủ nhà xác nhận',
  confirmed: 'đã xác nhận',
  rejected: 'bị từ chối',
  cancelled: 'đã hủy',
  completed: 'đã xem xong',
}
const CONTRACT_STATUS: Record<string, string> = {
  draft: 'bản nháp',
  'deposit-pending': 'chờ thanh toán cọc',
  'deposit-paid': 'đã đặt cọc',
  'awaiting-signature': 'chờ ký',
  'fully-signed-pending-deposit': 'đã ký đủ, chờ thanh toán cọc',
  active: 'đang hiệu lực',
  terminated: 'đã chấm dứt',
  cancelled: 'đã hủy',
  completed: 'đã hoàn tất',
}
const PAYMENT_STATUS: Record<string, string> = {
  unpaid: 'chưa thanh toán',
  paid: 'đã thanh toán',
  overdue: 'quá hạn',
  waived: 'được miễn',
}
const PAYMENT_TYPE: Record<string, string> = {
  rent: 'tiền thuê',
  deposit: 'tiền cọc',
  'deposit-topup': 'bù tiền cọc',
  'platform-fee': 'phí nền tảng',
  settlement: 'quyết toán nhận nhà',
}
const KYC_STATUS: Record<string, string> = {
  'not-started': 'chưa bắt đầu xác thực',
  pending: 'đã gửi hồ sơ, đang chờ nhân viên duyệt',
  verified: 'đã xác thực thành công',
  rejected: 'hồ sơ bị từ chối, cần gửi lại',
}

const dateTime = (value: Date | string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
const date = (value: Date | string): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: TIME_ZONE,
    dateStyle: 'short',
  }).format(new Date(value))
const money = (value: number): string =>
  `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đồng`

/**
 * Read-only answers about the signed-in customer's own bookings, contracts, invoices and KYC, for the
 * chat bot. Every query is filtered by the user id taken from the JWT (never from the request body or
 * the model), and the text returned holds no identity-document data, only what the customer sees
 * on their own screens.
 */
@Injectable()
export class PersonalDataService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(User) private readonly userRepo: Repository<User>
  ) {}

  run(tool: PersonalToolName, userId: string): Promise<string> {
    switch (tool) {
      case 'get_my_bookings':
        return this.bookings(userId)
      case 'get_my_contracts':
        return this.contracts(userId)
      case 'get_my_payments':
        return this.payments(userId)
      case 'get_my_kyc_status':
        return this.kyc(userId)
    }
  }

  private async bookings(userId: string): Promise<string> {
    const [asTenant, asLandlord] = await Promise.all([
      this.bookingRepo.find({
        where: { tenantId: userId } as FindOptionsWhere<Booking>,
      }),
      this.bookingRepo.find({
        where: { landlordId: userId } as FindOptionsWhere<Booking>,
      }),
    ])
    const byId = new Map<string, { booking: Booking; role: string }>()
    for (const booking of asTenant) {
      byId.set(booking._id.toHexString(), { booking, role: 'bạn là khách xem' })
    }
    for (const booking of asLandlord) {
      if (!byId.has(booking._id.toHexString())) {
        byId.set(booking._id.toHexString(), {
          booking,
          role: 'bạn là chủ nhà',
        })
      }
    }
    if (byId.size === 0) return 'Bạn chưa có lịch xem nhà nào.'

    const now = Date.now()
    const all = [...byId.values()]
    const open = (status: string): boolean =>
      status === 'pending' || status === 'confirmed'
    const upcoming = all
      .filter(
        ({ booking }) =>
          open(booking.status) && new Date(booking.visitAt).getTime() >= now
      )
      .sort(
        (a, b) =>
          new Date(a.booking.visitAt).getTime() -
          new Date(b.booking.visitAt).getTime()
      )
    const recent = all
      .filter(({ booking }) => !upcoming.some(item => item.booking === booking))
      .sort(
        (a, b) =>
          new Date(b.booking.visitAt).getTime() -
          new Date(a.booking.visitAt).getTime()
      )

    const line = ({
      booking,
      role,
    }: {
      booking: Booking
      role: string
    }): string =>
      `- ${booking.apartmentTitle}: ${dateTime(booking.visitAt)} (giờ Việt Nam), ${booking.method === 'video' ? 'xem qua video' : 'xem trực tiếp'}, ${BOOKING_STATUS[booking.status] ?? booking.status}, ${role}`
    const out: string[] = []
    if (upcoming.length > 0) {
      out.push('Lịch xem sắp tới:', ...upcoming.slice(0, MAX_ITEMS).map(line))
    } else {
      out.push('Bạn không có lịch xem nào sắp tới.')
    }
    if (recent.length > 0) {
      out.push('Lịch gần đây:', ...recent.slice(0, 3).map(line))
    }
    return out.join('\n')
  }

  private async userContracts(userId: string): Promise<Contract[]> {
    const [asTenant, asLandlord] = await Promise.all([
      this.contractRepo.find({
        where: { tenantId: userId } as FindOptionsWhere<Contract>,
      }),
      this.contractRepo.find({
        where: { landlordId: userId } as FindOptionsWhere<Contract>,
      }),
    ])
    const byId = new Map<string, Contract>()
    for (const contract of [...asTenant, ...asLandlord]) {
      byId.set(contract._id.toHexString(), contract)
    }
    return [...byId.values()].sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )
  }

  private async contracts(userId: string): Promise<string> {
    const contracts = await this.userContracts(userId)
    if (contracts.length === 0) return 'Bạn chưa có hợp đồng thuê nào.'
    const lines = contracts.slice(0, MAX_ITEMS).map(contract => {
      const role =
        contract.tenantId === userId ? 'bạn là bên thuê' : 'bạn là chủ nhà'
      const signed = `đã ký: bên thuê ${contract.signedByTenant ? 'rồi' : 'chưa'}, chủ nhà ${contract.signedByLandlord ? 'rồi' : 'chưa'}`
      const ledger = contract.contractHash
        ? `, mã băm hợp đồng ${contract.contractHash.slice(0, 12)}…, lưu vết: ${contract.ledgerStatus ?? 'chưa có'}`
        : ''
      return `- ${contract.contractCode} (${contract.propertyTitle}): ${CONTRACT_STATUS[contract.status ?? ''] ?? contract.status}, ${role}, từ ${date(contract.startDate)} đến ${date(contract.endDate)}, tiền thuê ${money(contract.monthlyRent)}/tháng, tiền cọc ${money(contract.deposit)}, ${signed}${ledger}`
    })
    return ['Hợp đồng của bạn:', ...lines].join('\n')
  }

  private async payments(userId: string): Promise<string> {
    const contracts = await this.userContracts(userId)
    if (contracts.length === 0)
      return 'Bạn chưa có hợp đồng nên chưa có hóa đơn.'
    const ids = contracts.map(c => c._id.toHexString())
    const titles = new Map(ids.map((id, i) => [id, contracts[i]!.contractCode]))
    const payments = await this.paymentRepo.find({
      where: {
        contractId: { $in: ids },
      } as unknown as FindOptionsWhere<Payment>,
    })
    // an invoice is the customer's own only when they are the payer
    const mine = payments.filter(
      payment => (payment.payerId ?? payment.tenantId) === userId
    )
    if (mine.length === 0) {
      return 'Bạn chưa có hóa đơn nào cần thanh toán.'
    }
    const open = mine
      .filter(p => p.status === 'unpaid' || p.status === 'overdue')
      .sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      )
    const paid = mine
      .filter(p => p.status === 'paid')
      .sort(
        (a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()
      )
    const line = (p: Payment): string =>
      `- ${PAYMENT_TYPE[p.type ?? 'rent'] ?? p.type} ${money(p.amount)}, hạn ${date(p.dueDate)}, ${PAYMENT_STATUS[p.status] ?? p.status}, hợp đồng ${titles.get(p.contractId) ?? ''}`
    const out: string[] = []
    out.push(
      open.length > 0
        ? `Hóa đơn cần thanh toán (${open.length}):`
        : 'Bạn không có hóa đơn nào đang chờ thanh toán.',
      ...open.slice(0, 8).map(line)
    )
    if (paid.length > 0)
      out.push('Đã thanh toán gần đây:', ...paid.slice(0, 3).map(line))
    return out.join('\n')
  }

  private async kyc(userId: string): Promise<string> {
    if (!ObjectId.isValid(userId)) return 'Không tìm thấy tài khoản.'
    const user = await this.userRepo.findOne({
      where: { _id: new ObjectId(userId) },
    })
    if (!user) return 'Không tìm thấy tài khoản.'
    return `Trạng thái eKYC của bạn: ${KYC_STATUS[user.kycStatus] ?? user.kycStatus}.`
  }
}
