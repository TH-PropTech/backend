import { BadRequestException } from '@nestjs/common'
import { BookingsController } from './bookings.controller'

describe('BookingsController', () => {
  it('returns a 400 HTTP exception when the tenant identity is missing', async () => {
    const service = {
      findByTenant: jest.fn(),
    }
    const controller = new BookingsController(service as never)

    await expect(
      controller.getMyBookings({ user: { _id: null } } as never, {})
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(service.findByTenant).not.toHaveBeenCalled()
  })
})
