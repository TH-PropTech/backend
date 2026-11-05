import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { RentalPackageDto } from './create-apartment.dto'

const basePackage = {
  packageId: 'pkg-12',
  version: 1,
  durationMonths: 12,
  monthlyRent: 12_000_000,
  depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
}

function errorsFor(extra: Record<string, unknown>): string[] {
  const dto = plainToInstance(RentalPackageDto, { ...basePackage, ...extra })
  return validateSync(dto).map(error => error.property)
}

describe('RentalPackageDto lease terms', () => {
  it('accepts a package without lease terms', () => {
    expect(errorsFor({})).toEqual([])
  })

  it('accepts in-range lease terms', () => {
    expect(
      errorsFor({
        paymentDay: 5,
        latePenaltyRate: 10,
        terminationNoticeDays: 45,
        customClauses: 'Không nuôi thú cưng.',
      })
    ).toEqual([])
  })

  it.each([
    ['paymentDay', 0],
    ['paymentDay', 32],
    ['latePenaltyRate', 21],
    ['terminationNoticeDays', 29],
    ['customClauses', 'a'.repeat(2001)],
  ])('rejects %s = %s', (field, value) => {
    expect(errorsFor({ [field]: value })).toContain(field)
  })
})
