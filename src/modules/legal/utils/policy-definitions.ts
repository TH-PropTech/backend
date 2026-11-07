import {
  RENT_TERMS_FREEDOM_BASIS,
  TERMINATION_NOTICE_REFERENCE,
} from './legal-citations'

export type PolicyDataType = 'percent' | 'number' | 'boolean' | 'string'

export interface PolicyDefinition {
  key: string
  type: PolicyDataType
  description: string
  unit?: string
  legalReference?: string
  min?: number
  max?: number
  isPublic: boolean
}

export const POLICY_DEFINITIONS: Record<string, PolicyDefinition> = {
  PLATFORM_FEE_PERCENT: {
    key: 'PLATFORM_FEE_PERCENT',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description: 'Phí hoa hồng dịch vụ của sàn PropTech',
    isPublic: true,
  },
  MAX_DEPOSIT_LIMIT_PERCENT: {
    key: 'MAX_DEPOSIT_LIMIT_PERCENT',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description:
      'Chủ đầu tư chỉ được thu tiền đặt cọc không quá 5% giá bán, cho thuê mua nhà ở hình thành trong tương lai',
    legalReference:
      'Khoản 5 Điều 23 Luật Kinh doanh Bất động sản 2023 (Luật số 29/2023/QH15)',
    isPublic: true,
  },
  DEPOSIT_REFUND_PENALTY_MULTIPLIER: {
    key: 'DEPOSIT_REFUND_PENALTY_MULTIPLIER',
    type: 'number',
    min: 1,
    max: 10,
    unit: 'lần',
    description:
      'Bên nhận cọc từ chối thực hiện hợp đồng phải trả lại cọc và khoản tiền tương đương giá trị cọc (tổng gấp 2 lần)',
    legalReference:
      'Khoản 2 Điều 328 Bộ luật Dân sự 2015 (Luật số 91/2015/QH13)',
    isPublic: true,
  },
  MAX_LATE_PAYMENT_INTEREST_RATE_YEAR: {
    key: 'MAX_LATE_PAYMENT_INTEREST_RATE_YEAR',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%/năm',
    description:
      'Lãi suất do các bên thỏa thuận không được vượt quá 20%/năm của khoản tiền vay',
    legalReference:
      'Khoản 1 Điều 468 Bộ luật Dân sự 2015 (Luật số 91/2015/QH13)',
    isPublic: true,
  },
  MIN_TERMINATION_NOTICE_DAYS: {
    key: 'MIN_TERMINATION_NOTICE_DAYS',
    type: 'number',
    min: 1,
    max: 365,
    unit: 'ngày',
    description:
      'Bên đơn phương chấm dứt hợp đồng thuê nhà ở phải thông báo cho bên kia biết trước ít nhất 30 ngày',
    legalReference: TERMINATION_NOTICE_REFERENCE,
    isPublic: true,
  },
  CONTRACT_MUST_BE_WRITTEN: {
    key: 'CONTRACT_MUST_BE_WRITTEN',
    type: 'boolean',
    unit: 'boolean',
    description:
      'Hợp đồng về nhà ở do các bên thỏa thuận và phải được lập thành văn bản',
    legalReference:
      'Khoản 1 Điều 163 Luật Nhà ở 2023 (Luật số 27/2023/QH15); Nghị định 02/2022/NĐ-CP (Mẫu số 05)',
    isPublic: true,
  },
  TENANT_RIGHT_ON_OWNERSHIP_TRANSFER: {
    key: 'TENANT_RIGHT_ON_OWNERSHIP_TRANSFER',
    type: 'boolean',
    unit: 'boolean',
    description:
      'Khi chủ sở hữu chuyển quyền sở hữu nhà ở đang cho thuê, bên mua phải tiếp tục thực hiện hợp đồng thuê đã ký',
    legalReference: 'Điều 173 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
    isPublic: true,
  },
  PROPERTY_MUST_HAVE_CERTIFICATE: {
    key: 'PROPERTY_MUST_HAVE_CERTIFICATE',
    type: 'boolean',
    unit: 'boolean',
    description:
      'Nhà ở tham gia giao dịch phải có Giấy chứng nhận, không tranh chấp, không bị kê biên thi hành án',
    legalReference: 'Điều 119 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
    isPublic: true,
  },
  MAINTENANCE_FEE_PERCENT: {
    key: 'MAINTENANCE_FEE_PERCENT',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description:
      'Kinh phí bảo trì phần sở hữu chung nhà chung cư bằng 2% giá trị căn hộ',
    legalReference: 'Điều 151 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
    isPublic: true,
  },
  RENT_ADJUST_REMAINING_THRESHOLD: {
    key: 'RENT_ADJUST_REMAINING_THRESHOLD',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description:
      'Bên cho thuê được điều chỉnh giá thuê khi thời hạn thuê còn lại bằng hoặc ít hơn 1/3 thời hạn hợp đồng',
    legalReference: 'Khoản 4 Điều 131 Luật Nhà ở 2023 (Luật số 27/2023/QH15)',
    isPublic: true,
  },
  LEASE_3M_MIN_MONTHS: {
    key: 'LEASE_3M_MIN_MONTHS',
    type: 'number',
    min: 1,
    max: 60,
    unit: 'tháng',
    description: 'Gói thuê ngắn hạn: thời hạn tối thiểu',
    legalReference: `Tự do thỏa thuận theo ${RENT_TERMS_FREEDOM_BASIS}`,
    isPublic: true,
  },
  LEASE_3M_DEPOSIT_MONTHS: {
    key: 'LEASE_3M_DEPOSIT_MONTHS',
    type: 'number',
    min: 0,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 3 tháng: tiền cọc tương đương 1 tháng thuê',
    legalReference: 'Điều 328 Bộ luật Dân sự 2015',
    isPublic: true,
  },
  LEASE_3M_PAYMENT_CYCLE: {
    key: 'LEASE_3M_PAYMENT_CYCLE',
    type: 'number',
    min: 1,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 3 tháng: chu kỳ thanh toán hàng tháng',
    isPublic: true,
  },
  LEASE_6M_MIN_MONTHS: {
    key: 'LEASE_6M_MIN_MONTHS',
    type: 'number',
    min: 1,
    max: 60,
    unit: 'tháng',
    description: 'Gói thuê trung hạn: thời hạn tối thiểu',
    legalReference: `Tự do thỏa thuận theo ${RENT_TERMS_FREEDOM_BASIS}`,
    isPublic: true,
  },
  LEASE_6M_DEPOSIT_MONTHS: {
    key: 'LEASE_6M_DEPOSIT_MONTHS',
    type: 'number',
    min: 0,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 6 tháng: tiền cọc tương đương 2 tháng thuê',
    legalReference: 'Điều 328 Bộ luật Dân sự 2015',
    isPublic: true,
  },
  LEASE_6M_PAYMENT_CYCLE: {
    key: 'LEASE_6M_PAYMENT_CYCLE',
    type: 'number',
    min: 1,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 6 tháng: chu kỳ thanh toán mỗi 3 tháng',
    isPublic: true,
  },
  LEASE_6M_DISCOUNT_PERCENT: {
    key: 'LEASE_6M_DISCOUNT_PERCENT',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description: 'Gói thuê 6 tháng: giảm giá thuê hàng tháng',
    isPublic: true,
  },
  LEASE_12M_MIN_MONTHS: {
    key: 'LEASE_12M_MIN_MONTHS',
    type: 'number',
    min: 1,
    max: 60,
    unit: 'tháng',
    description: 'Gói thuê dài hạn: thời hạn tối thiểu',
    legalReference: `Tự do thỏa thuận theo ${RENT_TERMS_FREEDOM_BASIS}`,
    isPublic: true,
  },
  LEASE_12M_DEPOSIT_MONTHS: {
    key: 'LEASE_12M_DEPOSIT_MONTHS',
    type: 'number',
    min: 0,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 12 tháng: tiền cọc tương đương 2 tháng thuê',
    legalReference: 'Điều 328 Bộ luật Dân sự 2015',
    isPublic: true,
  },
  LEASE_12M_PAYMENT_CYCLE: {
    key: 'LEASE_12M_PAYMENT_CYCLE',
    type: 'number',
    min: 1,
    max: 12,
    unit: 'tháng',
    description: 'Gói thuê 12 tháng: chu kỳ thanh toán mỗi 3 tháng',
    isPublic: true,
  },
  LEASE_12M_DISCOUNT_PERCENT: {
    key: 'LEASE_12M_DISCOUNT_PERCENT',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description: 'Gói thuê 12 tháng: giảm giá thuê hàng tháng',
    isPublic: true,
  },
  PIT_RENTAL_EXEMPT_THRESHOLD: {
    key: 'PIT_RENTAL_EXEMPT_THRESHOLD',
    type: 'number',
    min: 0,
    unit: 'VND/năm',
    description:
      'Cá nhân cho thuê BĐS có doanh thu từ 1 tỷ đồng/năm trở xuống không phải nộp thuế TNCN',
    legalReference: 'Luật Thuế Thu nhập cá nhân sửa đổi 2024',
    isPublic: true,
  },
  PIT_RENTAL_TAX_RATE: {
    key: 'PIT_RENTAL_TAX_RATE',
    type: 'percent',
    min: 0,
    max: 100,
    unit: '%',
    description:
      'Thuế TNCN cho phần doanh thu cho thuê nhà vượt ngưỡng miễn thuế',
    legalReference: 'Luật Thuế Thu nhập cá nhân sửa đổi 2024',
    isPublic: true,
  },
}

export function validatePolicyValue(key: string, value: string): void {
  const def = POLICY_DEFINITIONS[key]
  if (!def) return // Freeform if not registered

  if (def.type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      throw new Error(
        `Giá trị của chính sách ${key} phải là 'true' hoặc 'false'.`
      )
    }
    return
  }

  if (def.type === 'percent' || def.type === 'number') {
    const num = Number(value)
    if (isNaN(num)) {
      throw new Error(`Giá trị của chính sách ${key} phải là một số hợp lệ.`)
    }
    if (def.min !== undefined && num < def.min) {
      throw new Error(
        `Giá trị của chính sách ${key} không được nhỏ hơn ${def.min}.`
      )
    }
    if (def.max !== undefined && num > def.max) {
      throw new Error(
        `Giá trị của chính sách ${key} không được lớn hơn ${def.max}.`
      )
    }
  }
}
