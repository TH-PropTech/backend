import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Policy } from './schemas/policy.schema'

@Injectable()
export class PoliciesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PoliciesService.name)

  constructor(
    @InjectRepository(Policy)
    private readonly policyRepository: Repository<Policy>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaultPolicies()
  }

  /**
   * Seed default system-wide policies if they do not exist
   */
  private async seedDefaultPolicies(): Promise<void> {
    const defaultPolicies = [
      // ── Chính sách sàn PropTech ──
      {
        key: 'PLATFORM_FEE_PERCENT',
        value: '1',
        description: 'Phí hoa hồng dịch vụ của sàn PropTech',
        unit: '%',
        legalReference: undefined as string | undefined,
      },

      // ── Tài chính & Bảo đảm hợp đồng ──
      {
        key: 'MAX_DEPOSIT_LIMIT_PERCENT',
        value: '5',
        description:
          'Chủ đầu tư chỉ được thu tiền đặt cọc không quá 5% giá bán, cho thuê mua nhà ở hình thành trong tương lai',
        unit: '%',
        legalReference:
          'Khoản 5 Điều 23 Luật Kinh doanh Bất động sản 2023 (Luật số 29/2023/QH15)',
      },
      {
        key: 'DEPOSIT_REFUND_PENALTY_MULTIPLIER',
        value: '2',
        description:
          'Bên nhận cọc từ chối thực hiện hợp đồng phải trả lại cọc và khoản tiền tương đương giá trị cọc (tổng gấp 2 lần)',
        unit: 'lần',
        legalReference:
          'Khoản 2 Điều 328 Bộ luật Dân sự 2015 (Luật số 91/2015/QH13)',
      },
      {
        key: 'MAX_LATE_PAYMENT_INTEREST_RATE_YEAR',
        value: '20',
        description:
          'Lãi suất do các bên thỏa thuận không được vượt quá 20%/năm của khoản tiền vay',
        unit: '%/năm',
        legalReference:
          'Khoản 1 Điều 468 Bộ luật Dân sự 2015 (Luật số 91/2015/QH13)',
      },

      // ── Hợp đồng thuê nhà ở — Luật Nhà ở 2023 (Luật số 27/2023/QH15) ──
      {
        key: 'MIN_TERMINATION_NOTICE_DAYS',
        value: '30',
        description:
          'Bên đơn phương chấm dứt hợp đồng thuê nhà ở phải thông báo cho bên kia biết trước ít nhất 30 ngày',
        unit: 'ngày',
        legalReference:
          'Khoản 3 Điều 130 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
      },
      {
        key: 'CONTRACT_MUST_BE_WRITTEN',
        value: 'true',
        description:
          'Hợp đồng về nhà ở do các bên thỏa thuận và phải được lập thành văn bản',
        unit: 'boolean',
        legalReference:
          'Khoản 1 Điều 163 Luật Nhà ở 2023 (Luật số 27/2023/QH15); Nghị định 02/2022/NĐ-CP (Mẫu số 05)',
      },
      {
        key: 'TENANT_RIGHT_ON_OWNERSHIP_TRANSFER',
        value: 'true',
        description:
          'Khi chủ sở hữu chuyển quyền sở hữu nhà ở đang cho thuê, bên mua phải tiếp tục thực hiện hợp đồng thuê đã ký',
        unit: 'boolean',
        legalReference: 'Điều 173 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
      },
      {
        key: 'PROPERTY_MUST_HAVE_CERTIFICATE',
        value: 'true',
        description:
          'Nhà ở tham gia giao dịch phải có Giấy chứng nhận, không tranh chấp, không bị kê biên thi hành án',
        unit: 'boolean',
        legalReference: 'Điều 119 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
      },
      {
        key: 'MAINTENANCE_FEE_PERCENT',
        value: '2',
        description:
          'Kinh phí bảo trì phần sở hữu chung nhà chung cư bằng 2% giá trị căn hộ',
        unit: '%',
        legalReference: 'Điều 151 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
      },
      {
        key: 'RENT_ADJUST_REMAINING_THRESHOLD',
        value: '33',
        description:
          'Bên cho thuê được điều chỉnh giá thuê khi thời hạn thuê còn lại bằng hoặc ít hơn 1/3 thời hạn hợp đồng',
        unit: '%',
        legalReference:
          'Khoản 4 Điều 131 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
      },

      // ── Gói thuê căn hộ chung cư theo thời hạn (thỏa thuận — Điều 130 LNO 2023) ──
      {
        key: 'LEASE_3M_MIN_MONTHS',
        value: '3',
        description: 'Gói thuê ngắn hạn: thời hạn tối thiểu',
        unit: 'tháng',
        legalReference: 'Tự do thỏa thuận theo Điều 130 Luật Nhà ở 2023',
      },
      {
        key: 'LEASE_3M_DEPOSIT_MONTHS',
        value: '1',
        description: 'Gói thuê 3 tháng: tiền cọc tương đương 1 tháng thuê',
        unit: 'tháng',
        legalReference:
          'Điều 328 Bộ luật Dân sự 2015 (tự do thỏa thuận mức cọc)',
      },
      {
        key: 'LEASE_3M_PAYMENT_CYCLE',
        value: '1',
        description: 'Gói thuê 3 tháng: chu kỳ thanh toán hàng tháng',
        unit: 'tháng',
        legalReference: undefined as string | undefined,
      },
      {
        key: 'LEASE_6M_MIN_MONTHS',
        value: '6',
        description: 'Gói thuê trung hạn: thời hạn tối thiểu',
        unit: 'tháng',
        legalReference: 'Tự do thỏa thuận theo Điều 130 Luật Nhà ở 2023',
      },
      {
        key: 'LEASE_6M_DEPOSIT_MONTHS',
        value: '2',
        description: 'Gói thuê 6 tháng: tiền cọc tương đương 2 tháng thuê',
        unit: 'tháng',
        legalReference:
          'Điều 328 Bộ luật Dân sự 2015 (tự do thỏa thuận mức cọc)',
      },
      {
        key: 'LEASE_6M_PAYMENT_CYCLE',
        value: '3',
        description: 'Gói thuê 6 tháng: chu kỳ thanh toán mỗi 3 tháng',
        unit: 'tháng',
        legalReference: undefined as string | undefined,
      },
      {
        key: 'LEASE_6M_DISCOUNT_PERCENT',
        value: '3',
        description: 'Gói thuê 6 tháng: giảm giá thuê hàng tháng',
        unit: '%',
        legalReference: undefined as string | undefined,
      },
      {
        key: 'LEASE_12M_MIN_MONTHS',
        value: '12',
        description: 'Gói thuê dài hạn: thời hạn tối thiểu',
        unit: 'tháng',
        legalReference: 'Tự do thỏa thuận theo Điều 130 Luật Nhà ở 2023',
      },
      {
        key: 'LEASE_12M_DEPOSIT_MONTHS',
        value: '2',
        description: 'Gói thuê 12 tháng: tiền cọc tương đương 2 tháng thuê',
        unit: 'tháng',
        legalReference:
          'Điều 328 Bộ luật Dân sự 2015 (tự do thỏa thuận mức cọc)',
      },
      {
        key: 'LEASE_12M_PAYMENT_CYCLE',
        value: '3',
        description: 'Gói thuê 12 tháng: chu kỳ thanh toán mỗi 3 tháng',
        unit: 'tháng',
        legalReference: undefined as string | undefined,
      },
      {
        key: 'LEASE_12M_DISCOUNT_PERCENT',
        value: '5',
        description: 'Gói thuê 12 tháng: giảm giá thuê hàng tháng',
        unit: '%',
        legalReference: undefined as string | undefined,
      },

      // ── Thuế thu nhập cá nhân cho thuê nhà ──
      {
        key: 'PIT_RENTAL_EXEMPT_THRESHOLD',
        value: '1000000000',
        description:
          'Cá nhân cho thuê BĐS có doanh thu từ 1 tỷ đồng/năm trở xuống không phải nộp thuế TNCN',
        unit: 'VND/năm',
        legalReference:
          'Luật Thuế Thu nhập cá nhân sửa đổi 2024 (có hiệu lực 01/01/2026)',
      },
      {
        key: 'PIT_RENTAL_TAX_RATE',
        value: '5',
        description:
          'Thuế TNCN cho phần doanh thu cho thuê nhà vượt ngưỡng miễn thuế = (Doanh thu - 1 tỷ) × 5%',
        unit: '%',
        legalReference: 'Luật Thuế Thu nhập cá nhân sửa đổi 2024',
      },
    ]

    for (const def of defaultPolicies) {
      const exists = await this.policyRepository.findOne({
        where: { key: def.key },
      })
      if (!exists) {
        const policy = new Policy()
        policy.key = def.key
        policy.value = def.value
        policy.description = def.description
        policy.unit = def.unit
        if (def.legalReference) {
          policy.legalReference = def.legalReference
        }
        policy.status = 'active'
        policy.updatedBy = 'system'
        await this.policyRepository.save(policy)
        this.logger.log(`Seeded default policy: ${def.key} = ${def.value}`)
      }
    }
  }

  /**
   * Get all active policies
   */
  async findAll(): Promise<Policy[]> {
    return this.policyRepository.find()
  }

  /**
   * Get policy detail by its unique key
   */
  async findOne(key: string): Promise<Policy> {
    const policy = await this.policyRepository.findOne({ where: { key } })
    if (!policy) {
      throw new NotFoundException(`Không tìm thấy chính sách cấu hình: ${key}`)
    }
    return policy
  }

  /**
   * Get policy value directly as string or custom default
   */
  async getValue(key: string, defaultValue = ''): Promise<string> {
    try {
      const policy = await this.findOne(key)
      return policy.status === 'active' ? policy.value : defaultValue
    } catch {
      return defaultValue
    }
  }

  /**
   * Update policy value (typically for Admins)
   */
  async update(
    key: string,
    value: string,
    updatedBy?: string
  ): Promise<Policy> {
    const policy = await this.findOne(key)
    policy.value = value
    if (updatedBy) {
      policy.updatedBy = updatedBy
    }
    return this.policyRepository.save(policy)
  }
}
