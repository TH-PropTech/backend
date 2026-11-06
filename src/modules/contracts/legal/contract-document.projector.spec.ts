import { ContractDocumentProjector } from './contract-document.projector'
import { Contract } from '../schemas/contract.schema'
import { buildReviewedLeaseTemplateSeed } from './lease-template.seed'
import type { RentalPackageSnapshot } from '../../properties/utils/rental-package.util'

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

  describe('landlord custom clauses annex', () => {
    const clauses = 'Không nuôi thú cưng. Giờ yên tĩnh 22:00 đến 06:00.'

    it('adds a dedicated annex after the required articles and annexes', () => {
      const result = ContractDocumentProjector.projectDocument({
        ...mockContract,
        customClauses: clauses,
      } as Contract)

      expect(result.sections).toHaveLength(12)
      expect(result.annexes).toHaveLength(5)
      const annex = result.annexes[4]!
      expect(annex.id).toBe('LANDLORD_CUSTOM_CLAUSES')
      expect(annex.required).toBe(false)
      expect(annex.description).toContain(clauses)
      expect(annex.description).toContain('12 điều bắt buộc được ưu tiên')
    })

    it('adds no annex when the clauses are empty or blank', () => {
      for (const customClauses of [undefined, null, '   ']) {
        const result = ContractDocumentProjector.projectDocument({
          ...mockContract,
          customClauses,
        } as Contract)
        expect(result.annexes).toHaveLength(4)
      }
    })
  })

  describe('occupants and utility rates annexes', () => {
    it('adds an occupants annex listing each co-occupant', () => {
      const result = ContractDocumentProjector.projectDocument({
        ...mockContract,
        occupants: [
          { fullName: 'Nguyễn Văn A', birthYear: 1995, relationship: 'Bạn' },
        ],
      } as Contract)
      const annex = result.annexes.find(a => a.id === 'LEASE_OCCUPANTS')!
      expect(annex.description).toContain('Nguyễn Văn A, sinh năm 1995')
      expect(result.sections).toHaveLength(12)
    })

    it('adds a utility annex with the move-out settlement note', () => {
      const result = ContractDocumentProjector.projectDocument({
        ...mockContract,
        utilityRates: {
          electricityPerKwh: 3500,
          waterPerM3: 20000,
          serviceFeeMonthly: 200000,
        },
      } as Contract)
      const annex = result.annexes.find(a => a.id === 'LEASE_UTILITY_RATES')!
      expect(annex.description).toContain('điện 3.500 đồng/kWh')
      expect(annex.description).toContain('bàn giao lại nhà khi hết hợp đồng')
    })

    it('adds neither annex for contracts without the data', () => {
      const result = ContractDocumentProjector.projectDocument(
        mockContract as Contract
      )
      expect(result.annexes).toHaveLength(4)
    })
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

  it('projects an optional layout while preserving the fallback document', () => {
    const result = ContractDocumentProjector.projectDocument(
      mockContract as Contract,
      undefined,
      {
        profileKey: 'standard',
        version: 2,
        blocks: [
          { blockId: 'HEADER', order: 1, title: 'Header', visible: true },
        ],
        supplementaryClauses: [
          { id: 'extra', title: 'Extra', content: 'Visible', enabled: true },
          { id: 'off', title: 'Off', content: 'Hidden', enabled: false },
        ],
      }
    )

    expect(result.layout).toEqual(
      expect.objectContaining({ profileKey: 'standard', version: 2 })
    )
    expect(result.supplementaryClauses).toEqual([
      { id: 'extra', title: 'Extra', content: 'Visible', enabled: true },
    ])
    expect(result.sections).toHaveLength(12)
  })
  describe('move-out and deposit refund clauses', () => {
    const seed = buildReviewedLeaseTemplateSeed('PRIVATE_CIVIL_APARTMENT_LEASE')
    const template = {
      legalProfile: seed.legalProfile,
      version: 3,
      templateKey: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
      schemaVersion: seed.schemaVersion,
      contentHash: 'hash',
      clauses: seed.clauses,
      annexDefinitions: seed.annexDefinitions,
      citationIds: seed.citationIds,
    }
    const snapshotWith = (moveOutPolicy?: {
      responseDays: number
    }): RentalPackageSnapshot => ({
      packageId: 'pkg-12',
      version: 1,
      durationMonths: 12,
      monthlyRent: 18000000,
      depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
      resolvedDepositAmount: 36000000,
      ...(moveOutPolicy ? { moveOutPolicy } : {}),
    })
    const project = (
      packageSnapshot?: RentalPackageSnapshot
    ): ReturnType<typeof ContractDocumentProjector.projectDocument> =>
      ContractDocumentProjector.projectDocument(
        { ...mockContract, packageSnapshot } as Contract,
        template
      )

    it('prints the response days from the frozen package snapshot', () => {
      const article9 = project(snapshotWith({ responseDays: 7 })).sections[8]!
      expect(article9.content).toContain(
        'Bên B có 7 ngày kể từ ngày nhận được biên bản'
      )
      expect(article9.content).toContain(
        'có 7 ngày kể từ ngày nhận được bảng khấu trừ'
      )
      expect(article9.content).not.toContain('{{')
    })

    it.each([
      ['legacy snapshot without the field', snapshotWith()],
      ['contract without any snapshot', undefined],
    ])('falls back to 3 days for a %s', (_name, packageSnapshot) => {
      expect(project(packageSnapshot).sections[8]!.content).toContain(
        'Bên B có 3 ngày kể từ ngày nhận được biên bản'
      )
    })

    it('states direct refund by the landlord within 07 calendar days', () => {
      const article5 = project(snapshotWith()).sections[4]!.content
      const article9 = project(snapshotWith()).sections[8]!.content
      expect(article5).toContain('Bên A giữ')
      expect(article5).toContain('07 (bảy) ngày')
      expect(article5).not.toContain('ngày làm việc')
      expect(article5).toContain('không nhận, không giữ và không chuyển tiền')
      expect(article9).toContain('biên bản trả nhà')
      expect(article9).toContain('bảng khấu trừ')
      expect(article9).toContain('lời khai của Bên A')
      expect(article9).toContain('nền tảng không bảo đảm')
      expect(article9).toContain('được xem là Bên B chấp nhận')
      expect(article9).toContain('tranh chấp')
    })

    it('keeps the structured fallback consistent with the template', () => {
      const withSnapshot = ContractDocumentProjector.projectDocument({
        ...mockContract,
        packageSnapshot: snapshotWith({ responseDays: 10 }),
      } as Contract)
      const clause = withSnapshot.sections[7]!.content
      expect(clause).toContain('07 (bảy) ngày')
      expect(clause).not.toContain('ngày làm việc')
      expect(clause).toContain('Bên Thuê có 10 ngày')
      expect(clause).toContain('biên bản trả nhà')
      expect(clause).toContain('bảng khấu trừ')

      const legacy = ContractDocumentProjector.projectDocument(
        mockContract as Contract
      )
      expect(legacy.sections[7]!.content).toContain('Bên Thuê có 3 ngày')
    })

    it('contains no mojibake in the new clauses', () => {
      const text = project(snapshotWith())
        .sections.map(s => s.content)
        .join(' ')
      expect(text).not.toMatch(/Ã|Â|â€|Ä/)
    })
  })
})
