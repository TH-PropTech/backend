import {
  buildPublicServiceChecklist,
  parsePublicServiceChecklistPurpose,
} from './public-service-checklist'

describe('public service checklist', () => {
  const contract = {
    executionMethod: 'POC_ECONSENT' as const,
    notarizationStatus: 'not-requested' as const,
    contentLockedHash: 'a'.repeat(64),
    signedByTenant: true,
    signedByLandlord: true,
  }

  it('returns a truthful temporary-residence checklist for POC e-consent', () => {
    const result = buildPublicServiceChecklist(contract)

    expect(result.purpose).toBe('temporary-residence')
    expect(result.externalProcedureCompleted).toBe(false)
    expect(result.officialSourceUrl).toBe('https://dichvucong.bocongan.gov.vn/')
    expect(result.disclaimer).toBe(
      'Ký xác nhận ở chế độ thử nghiệm không phải chữ ký số có chứng thư và không thay thế công chứng/chứng thực.'
    )
    expect(result.disclaimer).not.toMatch(/[A-Z]{3,}(_[A-Z0-9]+)+/)
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'notarization-or-authentication',
          status: 'required-before-submission',
        }),
      ])
    )
  })

  it('marks notarization evidence without claiming the external procedure is complete', () => {
    const result = buildPublicServiceChecklist({
      ...contract,
      executionMethod: 'WET_INK',
      notarizationStatus: 'authenticated',
    })

    expect(result.externalProcedureCompleted).toBe(false)
    expect(result.disclaimer).not.toMatch(/[A-Z]{3,}(_[A-Z0-9]+)+/)
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'notarization-or-authentication',
          status: 'evidence-present',
        }),
      ])
    )
  })

  it('rejects unsupported public-service purposes', () => {
    expect(() =>
      parsePublicServiceChecklistPurpose('tourist-registration')
    ).toThrow('PUBLIC_SERVICE_PURPOSE_UNSUPPORTED')
  })

  it('rejects blank purposes instead of defaulting silently', () => {
    expect(() => parsePublicServiceChecklistPurpose('')).toThrow(
      'PUBLIC_SERVICE_PURPOSE_REQUIRED'
    )
  })
})
