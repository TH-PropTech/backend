import { ContractDocumentProjector } from './contract-document.projector'
import { Contract } from '../schemas/contract.schema'

describe('ContractDocumentProjector', () => {
  const mockContract: Partial<Contract> = {
    contractCode: 'CT-2026-001',
    propertyTitle: 'Căn hộ Masteri Thảo Điền T2-15.08',
    propertyAddress: '159 Xa Lộ Hà Nội, P. Thảo Điền, TP. Thủ Đức',
    propertyArea: 75,
    propertyFurniture: 'Full nội thất cao cấp',
    propertyValue: 18000000,
    monthlyRent: 18000000,
    deposit: 36000000,
    paymentDay: 5,
    startDate: new Date('2026-10-01'),
    endDate: new Date('2027-10-01'),
    durationMonths: 12,
    terminationNoticeDays: 30,
    latePenaltyRate: 10,
    depositAgreementCode: 'DA-2026-001',
    contentRevision: 1,
    contentLockedHash: null,
    contentLockedAt: null,
  }

  it('should project a draft contract into 12 structured articles and 4 annexes', () => {
    const result = ContractDocumentProjector.projectDocument(
      mockContract as Contract
    )

    expect(result.mode).toBe('draft')
    expect(result.integrity).toBe('not-locked')
    expect(result.sections).toHaveLength(12)
    expect(result.annexes).toHaveLength(4)

    // Check each article number
    for (let i = 1; i <= 12; i++) {
      const sec = result.sections.find(s => s.number === i)
      expect(sec).toBeDefined()
      expect(sec?.protected).toBe(true)
      expect(sec?.hash).toBeDefined()
      expect(sec?.content).toBeDefined()
    }

    expect(result.sections[0]!.content).toContain('Masteri Thảo Điền')
    expect(result.sections[0]!.title).toBe('Các thông tin về nhà ở cho thuê')
    for (const section of result.sections) {
      expect(section.title).not.toMatch(/^Điều\s+\d+\./)
    }
    expect(result.sections[1]!.content).toContain('18.000.000 VNĐ')
    expect(result.sections[7]!.content).toContain('36.000.000 VNĐ')
  })

  it('should project a locked contract with mode=locked and integrity=valid', () => {
    const lockedContract: Partial<Contract> = {
      ...mockContract,
      contentLockedHash: 'mock-locked-sha256-hash',
      contentLockedAt: new Date('2026-09-14T08:00:00Z'),
      contentRevision: 2,
    }

    const result = ContractDocumentProjector.projectDocument(
      lockedContract as Contract
    )

    expect(result.mode).toBe('locked')
    expect(result.integrity).toBe('valid')
    expect(result.lockedHash).toBe('mock-locked-sha256-hash')
    expect(result.lockedAt).toBe('2026-09-14T08:00:00.000Z')
    expect(result.revision).toBe(2)
  })

  it('exposes the same canonical artifact identity used by signing and download', () => {
    const artifactContract: Partial<Contract> = {
      ...mockContract,
      contentLockedHash: 'a'.repeat(64),
      contentLockedAt: new Date('2026-09-14T08:00:00Z'),
      artifactRef: {
        artifactId: 'artifact-1',
        revision: 3,
        templateKey: 'lease-vn',
        templateVersion: 4,
        hashSchemaVersion: 2,
        artifactHash: 'a'.repeat(64),
        contentType: 'application/pdf',
        lockedAt: new Date('2026-09-14T08:00:00Z'),
      },
    }

    const result = ContractDocumentProjector.projectDocument(
      artifactContract as Contract
    )
    expect(result.lockedHash).toBe('a'.repeat(64))
    expect(result.templateVersion).toBe('lease-vn@4')
    expect(result.canonicalArtifact).toEqual({
      artifactId: 'artifact-1',
      revision: 3,
      templateKey: 'lease-vn',
      templateVersion: 4,
      artifactHash: 'a'.repeat(64),
      contentType: 'application/pdf',
    })
  })
})
