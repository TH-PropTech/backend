import {
  assertMeterPhotosHosted,
  buildUtilityChargeSuggestions,
} from './utility-charges.util'

const rates = {
  electricityPerKwh: 3500,
  waterPerM3: 20000,
  serviceFeeMonthly: 200000,
}
const base = {
  rates,
  moveIn: { electricity: 1200, water: 40 },
  moveOut: { electricity: 1450, water: 46 },
  moveInPhotos: {
    electricity: ['https://cdn.example.com/in-e.jpg'],
    water: ['https://cdn.example.com/in-w.jpg'],
  },
  moveOutPhotos: {
    electricity: ['https://cdn.example.com/out-e.jpg'],
    water: ['https://cdn.example.com/out-w.jpg'],
  },
  unpaidServiceMonths: 0,
}

describe('buildUtilityChargeSuggestions', () => {
  it('prices electricity and water from the readings and attaches both photo sets', () => {
    const { lines, notes } = buildUtilityChargeSuggestions(base)
    const electricity = lines.find(line => line.kind === 'electricity')!
    expect(electricity.amount).toBe(875_000)
    expect(electricity.reason).toContain('chỉ số đầu 1200')
    expect(electricity.reason).toContain('chỉ số cuối 1450')
    expect(electricity.reason).toContain('tiêu thụ 250 kWh')
    expect(electricity.evidenceUrls).toEqual([
      'https://cdn.example.com/in-e.jpg',
      'https://cdn.example.com/out-e.jpg',
    ])
    expect(lines.find(line => line.kind === 'water')?.amount).toBe(120_000)
    expect(lines.every(line => line.source === 'meter-suggestion')).toBe(true)
    expect(notes).toEqual(['NO_SERVICE_MONTHS'])
  })

  it('adds a service line only when the landlord states the unpaid months', () => {
    const withMonths = buildUtilityChargeSuggestions({
      ...base,
      unpaidServiceMonths: 3,
    })
    expect(withMonths.lines.find(line => line.kind === 'service')?.amount).toBe(
      600_000
    )
    const withoutMonths = buildUtilityChargeSuggestions(base)
    expect(withoutMonths.lines.some(line => line.kind === 'service')).toBe(
      false
    )
    expect(withoutMonths.notes).toContain('NO_SERVICE_MONTHS')
  })

  it('suggests nothing without rates', () => {
    expect(buildUtilityChargeSuggestions({ ...base, rates: null })).toEqual({
      lines: [],
      notes: ['NO_RATES'],
    })
  })

  it('skips meter lines without move-in readings but still prices the service fee', () => {
    const result = buildUtilityChargeSuggestions({
      ...base,
      moveIn: null,
      unpaidServiceMonths: 1,
    })
    expect(result.notes).toContain('NO_MOVE_IN_READINGS')
    expect(result.lines.map(line => line.kind)).toEqual(['service'])
  })

  it('skips a meter whose reading went down and reports it', () => {
    const result = buildUtilityChargeSuggestions({
      ...base,
      moveOut: { electricity: 1100, water: 46 },
    })
    expect(result.notes).toContain('ELECTRICITY_READING_REGRESSION')
    expect(result.lines.map(line => line.kind)).toEqual(['water'])
  })

  it('omits lines with no consumption and caps photos at four per line', () => {
    const zero = buildUtilityChargeSuggestions({
      ...base,
      moveOut: base.moveIn,
    })
    expect(zero.lines).toEqual([])
    const many = buildUtilityChargeSuggestions({
      ...base,
      moveInPhotos: {
        electricity: ['a', 'b', 'c'].map(
          x => `https://cdn.example.com/${x}.jpg`
        ),
        water: [],
      },
      moveOutPhotos: {
        electricity: ['d', 'e', 'f'].map(
          x => `https://cdn.example.com/${x}.jpg`
        ),
        water: [],
      },
    })
    expect(
      many.lines.find(line => line.kind === 'electricity')?.evidenceUrls
    ).toHaveLength(4)
  })
})

describe('assertMeterPhotosHosted', () => {
  const photos = {
    electricity: ['https://cdn.example.com/e.jpg'],
    water: ['https://evil.example.com/w.jpg'],
  }
  const storage = {
    isOwnPublicUrl: (url: string): boolean =>
      url.startsWith('https://cdn.example.com/'),
  }

  it('rejects photos that are not hosted by the system', () => {
    expect(() => assertMeterPhotosHosted(storage, photos)).toThrow(
      'Ảnh công tơ phải được tải lên từ hệ thống.'
    )
  })

  it('accepts hosted photos and skips the check without storage or photos', () => {
    expect(() =>
      assertMeterPhotosHosted(storage, {
        electricity: photos.electricity,
        water: ['https://cdn.example.com/w.jpg'],
      })
    ).not.toThrow()
    expect(() => assertMeterPhotosHosted(undefined, photos)).not.toThrow()
    expect(() => assertMeterPhotosHosted(storage, undefined)).not.toThrow()
  })
})
