import {
  isValidOccupantList,
  isValidUtilityRates,
} from './amendment-field-validators.util'

describe('isValidOccupantList', () => {
  const person = {
    fullName: 'Nguyễn Văn A',
    birthYear: 1995,
    relationship: 'Bạn',
  }

  it('accepts a list of well-formed occupants', () => {
    expect(isValidOccupantList([person])).toBe(true)
  })

  it('accepts an empty list', () => {
    expect(isValidOccupantList([])).toBe(true)
  })

  it.each([
    ['blank name', { ...person, fullName: '  ' }],
    ['fractional birth year', { ...person, birthYear: 1995.5 }],
    ['birth year out of range', { ...person, birthYear: 1800 }],
    ['missing relationship', { ...person, relationship: '' }],
  ])('rejects %s', (_label, bad) => {
    expect(isValidOccupantList([bad])).toBe(false)
  })

  it('rejects more than 20 occupants and non-arrays', () => {
    expect(isValidOccupantList(Array.from({ length: 21 }, () => person))).toBe(
      false
    )
    expect(isValidOccupantList('x')).toBe(false)
  })
})

describe('isValidUtilityRates', () => {
  const rates = {
    electricityPerKwh: 3500,
    waterPerM3: 20000,
    serviceFeeMonthly: 200000,
  }

  it('accepts non-negative rates with an optional note', () => {
    expect(isValidUtilityRates({ ...rates, note: 'Theo chỉ số công tơ' })).toBe(
      true
    )
  })

  it('rejects negative, non-numeric or missing rates', () => {
    expect(isValidUtilityRates({ ...rates, electricityPerKwh: -1 })).toBe(false)
    expect(isValidUtilityRates({ ...rates, waterPerM3: '20000' })).toBe(false)
    expect(isValidUtilityRates({ electricityPerKwh: 1 })).toBe(false)
    expect(isValidUtilityRates(null)).toBe(false)
  })
})
