export type LegalBasisStatus = 'active' | 'needs-review'

export type LegalBasis = {
  id: string
  citation: string
  sourceUrl: string
  effectiveFrom: string
  lastCheckedAt: string
  status: LegalBasisStatus
}

export const LEGAL_BASIS_REGISTRY: readonly LegalBasis[] = [
  {
    id: 'DECREE_96_2024_APPENDIX_II_RESIDENTIAL_LEASE',
    citation: 'Nghị định 96/2024/NĐ-CP, Phụ lục II – Mẫu hợp đồng thuê nhà ở',
    sourceUrl:
      'https://xaydungchinhsach.chinhphu.vn/mau-hop-dong-thue-nha-o-119240827172441217.htm',
    effectiveFrom: '2024-08-01',
    lastCheckedAt: '2026-09-16',
    status: 'active',
  },
  {
    id: 'HOUSING_LAW_2023_ART_163_164',
    citation: 'Luật Nhà ở 27/2023/QH15, Điều 163–164',
    sourceUrl: 'https://vbpl.vn/',
    effectiveFrom: '2025-01-01',
    lastCheckedAt: '2026-09-08',
    status: 'active',
  },
  {
    id: 'REAL_ESTATE_BUSINESS_LAW_2023_ART_44_46',
    citation: 'Luật Kinh doanh bất động sản 29/2023/QH15, Điều 44–46',
    sourceUrl: 'https://vanban.chinhphu.vn/',
    effectiveFrom: '2025-01-01',
    lastCheckedAt: '2026-09-08',
    status: 'active',
  },
  {
    id: 'NATIONAL_PUBLIC_SERVICE_TEMPORARY_RESIDENCE_1004194',
    citation: 'TTHC 1.004194 – Đăng ký tạm trú',
    sourceUrl:
      'https://thutuc.dichvucong.gov.vn/p/home/dvc-chi-tiet-thu-tuc-hanh-chinh.html?ma_thu_tuc=1.004194',
    effectiveFrom: '2021-07-01',
    lastCheckedAt: '2026-09-16',
    status: 'active',
  },
]

export function getActiveLegalBasis(ids: string[]): LegalBasis[] {
  const selected = ids.map(id =>
    LEGAL_BASIS_REGISTRY.find(item => item.id === id)
  )
  if (selected.some(item => !item || item.status !== 'active')) {
    throw new Error('LEGAL_BASIS_NOT_ACTIVE')
  }
  return selected as LegalBasis[]
}
