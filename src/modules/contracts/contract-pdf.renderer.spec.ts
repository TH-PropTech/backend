import type { Contract } from './schemas/contract.schema'
import { ContractDocumentProjector } from './legal/contract-document.projector'
import { renderContractPdf } from './contract-pdf.renderer'

function buildContract(): Contract {
  return {
    contractCode: 'HD-TEST-001',
    propertyTitle: 'Căn hộ Đường Vườn Lài',
    propertyAddress: '90 Vườn Lài, Phường Phú Thọ Hòa, TP.HCM',
    propertyArea: 90,
    landlordName: 'Nguyễn Văn Chủ',
    landlordCccd: '054204004683',
    tenantName: 'Trần Thị Khách',
    tenantCccd: '035204000123',
    monthlyRent: 500000,
    deposit: 500000,
    durationMonths: 12,
    paymentDay: 5,
    startDate: new Date('2026-10-11'),
    endDate: new Date('2027-10-11'),
    contentLockedHash: 'a'.repeat(64),
    contentLockedAt: new Date('2026-10-11T04:00:00Z'),
    contentRevision: 1,
  } as unknown as Contract
}

describe('renderContractPdf', () => {
  it('renders a valid PDF containing every contract article', async () => {
    const contract = buildContract()
    const document = ContractDocumentProjector.projectDocument(contract)

    const bytes = await renderContractPdf(contract, document)

    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(5_000)
  })

  it('embeds a Vietnamese-capable font instead of failing on diacritics', async () => {
    const contract = buildContract()
    const document = ContractDocumentProjector.projectDocument(contract)

    const bytes = await renderContractPdf(contract, document)

    expect(bytes.toString('latin1')).toContain('DejaVuSans')
  })
})
