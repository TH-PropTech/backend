import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateRentalApplicationDto } from './create-rental-application.dto'

const validInput = {
  apartmentId: 'apartment-1',
  packageId: 'package-12',
  packageVersion: 1,
  occupants: 2,
  moveInDate: '2030-01-01',
  occupation: 'Engineer',
  hasPets: false,
  disclosureVersion: 'rental-review-v1',
  acknowledgedDisclosureIds: [
    'listing-terms',
    'pre-contract-request',
    'future-payment-and-signing',
  ],
}

describe('CreateRentalApplicationDto', () => {
  it('accepts only the tenant application fields', async () => {
    const errors = await validate(
      plainToInstance(CreateRentalApplicationDto, validInput),
      { whitelist: true, forbidNonWhitelisted: true }
    )

    expect(errors).toHaveLength(0)
  })

  it.each([
    ['durationMonths', 24],
    ['monthlyRent', 99_000_000],
    ['depositAmount', 198_000_000],
    ['tenantId', 'forged-tenant'],
    ['landlordId', 'forged-landlord'],
  ])(
    'rejects forged authority or commercial field %s',
    async (field, value) => {
      const errors = await validate(
        plainToInstance(CreateRentalApplicationDto, {
          ...validInput,
          [field]: value,
        }),
        { whitelist: true, forbidNonWhitelisted: true }
      )

      expect(errors.map(error => error.property)).toContain(field)
    }
  )
})
