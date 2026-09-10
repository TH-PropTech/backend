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

  it('returns a truthful permanent-residence checklist for POC e-consent', () => {
    const result = buildPublicServiceChecklist(contract)

    expect(result.purpose).toBe('permanent-residence')
    expect(result.externalProcedureCompleted).toBe(false)
    expect(result.officialSourceUrl).toBe(
      'https://thutuc.dichvucong.gov.vn/p/home/dvc-tthc-thu-tuc-hanh-chinh-chi-tiet.html?ma_thu_tuc=6007'
    )
    expect(result.disclaimer).toContain('POC_ECONSENT')
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
