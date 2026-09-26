import type {
  ContractTemplateAddendum,
  ContractTemplateAnnexDefinition,
  ContractTemplateClause,
} from './contract-template.schema'
import type { LegalProfile } from './legal-profile.resolver'
import { hashText } from './contract-template.canonical'

const REQUIRED_ANNEXES: readonly ContractTemplateAnnexDefinition[] = [
  {
    id: 'HANDOVER_RECORD',
    title: 'Phụ lục 1: Biên bản bàn giao hiện trạng căn hộ',
    description:
      'Ghi nhận chỉ số công tơ, tình trạng căn hộ và thời điểm bàn giao.',
    required: true,
  },
  {
    id: 'INVENTORY_LIST',
    title: 'Phụ lục 2: Danh mục thiết bị, nội thất',
    description:
      'Bảng kiểm kê số lượng, tình trạng thiết bị và tài sản bàn giao.',
    required: true,
  },
  {
    id: 'BUILDING_RULES',
    title: 'Phụ lục 3: Nội quy quản lý và sử dụng nhà chung cư',
    description: 'Nội quy vận hành, an ninh, PCCC và sử dụng tiện ích chung.',
    required: true,
  },
  {
    id: 'DEPOSIT_RECEIPT',
    title: 'Phụ lục 4: Thỏa thuận đặt cọc bảo đảm thực hiện hợp đồng',
    description: 'Biên nhận và nguyên tắc quản lý, hoàn trả tiền đặt cọc.',
    required: true,
  },
]

const ARTICLE_DEFINITIONS = [
  [
    'Thông tin nhà ở cho thuê',
    'Mô tả nhà ở, địa chỉ, diện tích, công năng và tài sản kèm theo: {{property}}, {{propertyAddress}}, {{propertyArea}}, {{propertyFurniture}}.',
    ['property', 'propertyAddress', 'propertyArea', 'propertyFurniture'],
  ],
  [
    'Thời hạn thuê và bàn giao',
    'Thời hạn thuê từ {{startDate}} đến {{endDate}}, thời điểm bàn giao và hồ sơ kèm theo được ghi nhận trong các phụ lục của hợp đồng.',
    ['startDate', 'endDate', 'durationMonths'],
  ],
  [
    'Giá thuê, đặt cọc và phương thức thanh toán',
    'Giá thuê là {{monthlyRent}} đồng/tháng; tiền đặt cọc là {{deposit}} đồng; thanh toán vào ngày {{paymentDay}} hàng tháng bằng phương thức do các bên xác nhận.',
    ['monthlyRent', 'deposit', 'paymentDay'],
  ],
  [
    'Quyền và nghĩa vụ về bàn giao',
    'Bên cho thuê bàn giao đúng hiện trạng và hồ sơ; bên thuê kiểm tra, nhận bàn giao và phản hồi sai lệch trong biên bản bàn giao.',
    ['property', 'propertyAddress'],
  ],
  [
    'Mục đích và nguyên tắc sử dụng',
    'Nhà ở chỉ được sử dụng đúng công năng, tuân thủ pháp luật, nội quy tòa nhà, quy định an ninh và phòng cháy chữa cháy.',
    [],
  ],
  [
    'Quyền và nghĩa vụ của bên cho thuê',
    'Bên cho thuê bảo đảm quyền sử dụng ổn định, bảo trì phần thuộc trách nhiệm của mình và cung cấp thông tin pháp lý trung thực về nhà ở.',
    [],
  ],
  [
    'Quyền và nghĩa vụ của bên thuê',
    'Bên thuê thanh toán đúng hạn, bảo quản nhà ở, chịu chi phí do lỗi của mình và hoàn trả nhà ở theo hiện trạng đã thỏa thuận, trừ hao mòn hợp lý.',
    [],
  ],
  [
    'Bảo trì, sửa chữa và hoàn trả đặt cọc',
    'Việc sửa chữa, xử lý hư hỏng và hoàn trả đặt cọc được đối chiếu với biên bản bàn giao, danh mục tài sản và nghĩa vụ thanh toán còn tồn đọng.',
    ['deposit'],
  ],
  [
    'Vi phạm, lãi chậm trả và bồi thường',
    'Bên vi phạm phải khắc phục, bồi thường thiệt hại thực tế và chịu lãi chậm trả trong giới hạn pháp luật. Thời hạn thông báo trước là {{terminationNoticeDays}} ngày.',
    ['latePenaltyRate', 'terminationNoticeDays'],
  ],
  [
    'Chấm dứt hợp đồng và bất khả kháng',
    'Hợp đồng chấm dứt khi hết hạn, theo thỏa thuận, do vi phạm hoặc sự kiện bất khả kháng theo quy định pháp luật và điều kiện thông báo hợp lệ.',
    ['terminationNoticeDays'],
  ],
  [
    'Giải quyết tranh chấp',
    'Các bên ưu tiên thương lượng thiện chí; nếu không giải quyết được thì tranh chấp được đưa tới cơ quan có thẩm quyền theo quy định pháp luật.',
    [],
  ],
  [
    'Hiệu lực và điều khoản thi hành',
    'Hợp đồng có hiệu lực theo thời điểm ký hợp lệ, gồm phần canonical legal body, các biến thương mại đã xác nhận và phụ lục được dẫn chiếu.',
    [],
  ],
] as const

export type LeaseTemplateSeed = {
  legalProfile: LegalProfile
  clauses: ContractTemplateClause[]
  annexDefinitions: ContractTemplateAnnexDefinition[]
  allowedVariables: string[]
  addenda: ContractTemplateAddendum[]
  citationIds: string[]
  schemaVersion: number
  referenceOnly: boolean
  reviewReference: string
}

export function buildReviewedLeaseTemplateSeed(
  legalProfile: LegalProfile
): LeaseTemplateSeed {
  const isBusiness = legalProfile === 'REAL_ESTATE_BUSINESS_STANDARD'
  const citationIds = isBusiness
    ? ['DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE']
    : [
        'DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE',
        'HOUSING_LAW_2023_ART_163_164',
      ]
  const clauses = ARTICLE_DEFINITIONS.map(
    ([heading, content, variableRefs], index) => ({
      id: `article-${index + 1}`,
      number: index + 1,
      heading,
      content,
      variableRefs: [...variableRefs],
      contentHash: hashText(`${heading}\n${content}`),
      citationIds,
      protected: true,
    })
  )
  return {
    legalProfile,
    clauses,
    annexDefinitions: REQUIRED_ANNEXES.map(annex => ({ ...annex })),
    allowedVariables: [
      'landlord',
      'tenant',
      'property',
      'propertyAddress',
      'startDate',
      'endDate',
      'durationMonths',
      'monthlyRent',
      'deposit',
      'paymentDay',
      'terminationNoticeDays',
      'latePenaltyRate',
    ],
    addenda: REQUIRED_ANNEXES.map(annex => ({
      id: annex.id,
      title: annex.title,
      content: annex.description ?? '',
      enabled: true,
    })),
    citationIds,
    schemaVersion: 2,
    referenceOnly: !isBusiness,
    reviewReference: 'PROP-321-LEGAL-REVIEW-2026-09',
  }
}
