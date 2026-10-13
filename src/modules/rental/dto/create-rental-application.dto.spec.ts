import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateRentalApplicationDto } from './create-rental-application.dto'

const baseDto = {
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

describe('CreateRentalApplicationDto optional phase 2 fields', () => {
  it('accepts valid occupants, vehicles, emergency contact, cycle and booking id', async () => {
    const dto = plainToInstance(CreateRentalApplicationDto, {
      ...baseDto,
      occupants: 2,
      occupantsDetail: [
        { fullName: 'Nguyen Van A', birthYear: 1998, relationship: 'Spouse' },
      ],
      vehicles: [{ type: 'motorbike', quantity: 1 }],
      emergencyContact: {
        fullName: 'Nguyen Van B',
        relationship: 'Parent',
        phone: '+84912345678',
      },
      selectedPaymentCycleMonths: 3,
      viewingBookingId: '507f1f77bcf86cd799439011',
    })

    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true })
    ).toEqual([])
  })

  it('rejects invalid vehicle types and payment cycles', async () => {
    const dto = plainToInstance(CreateRentalApplicationDto, {
      ...baseDto,
      vehicles: [{ type: 'scooter', quantity: 1 }],
      selectedPaymentCycleMonths: 2,
    })

    const errors = await validate(dto)
    expect(errors.map(error => error.property)).toEqual(
      expect.arrayContaining(['vehicles', 'selectedPaymentCycleMonths'])
    )
  })

  it('rejects a full identity number in occupant details as an unknown field', async () => {
    const dto = plainToInstance(CreateRentalApplicationDto, {
      ...baseDto,
      occupants: 2,
      occupantsDetail: [
        {
          fullName: 'Nguyen Van A',
          birthYear: 1998,
          relationship: 'Spouse',
          cccd: '079098001234',
        },
      ],
    })

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
    expect(
      errors[0]?.children?.[0]?.children?.map(error => error.property)
    ).toContain('cccd')
  })
})
