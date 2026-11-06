import { assertWithinApartmentOccupantLimit } from './occupant-limit.util'

describe('assertWithinApartmentOccupantLimit', () => {
  it('rejects more occupants than the apartment allows', () => {
    expect(() => assertWithinApartmentOccupantLimit(4, 5)).toThrow(
      'Căn hộ này cho phép tối đa 4 người ở.'
    )
  })

  it('accepts occupants equal to the limit', () => {
    expect(() => assertWithinApartmentOccupantLimit(4, 4)).not.toThrow()
  })

  it.each([null, undefined])(
    'does not block legacy listings without a limit (%s)',
    limit => {
      expect(() => assertWithinApartmentOccupantLimit(limit, 12)).not.toThrow()
    }
  )
})
