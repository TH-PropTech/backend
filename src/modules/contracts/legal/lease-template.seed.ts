import type {
  ContractTemplateAddendum,
  ContractTemplateAnnexDefinition,
  ContractTemplateClause,
} from '../schemas/contract-template.schema'
import type { LegalProfile } from './legal-profile.resolver'
import { hashText } from './contract-template.canonical'
import { LEASE_ARTICLE_DEFINITIONS } from './lease-template.articles'

/** Bản soạn 2026-11 (thêm lãi chậm trả theo Điều 357 và 468, báo trước theo khoản 4 Điều 172 Luật Nhà ở, chế tài khoản 2 Điều 328; trước đó 2026-10 thêm biên bản trả nhà, bảng khấu trừ cọc, hoàn cọc 07 ngày): chưa có xác nhận của luật sư; ghi rõ để không bị hiểu là đã thẩm định. Đổi chuỗi này sẽ làm bootstrap phát hành phiên bản mẫu kế tiếp. */
export const LEASE_TEMPLATE_SEED_REVIEW_REFERENCE =
  'PROP-321-LEGAL-DRAFT-2026-11-PENALTY-CITATIONS-PENDING-COUNSEL-REVIEW'

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
  const clauses = LEASE_ARTICLE_DEFINITIONS.map(
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
      'moveOutResponseDays',
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
    reviewReference: LEASE_TEMPLATE_SEED_REVIEW_REFERENCE,
  }
}
