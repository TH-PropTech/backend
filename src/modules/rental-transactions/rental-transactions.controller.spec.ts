import { ForbiddenException } from '@nestjs/common'
import { RentalTransactionsController } from './rental-transactions.controller'

describe('RentalTransactionsController', () => {
  it('passes JWT scope to timeline service', async () => {
    const service = {
      getTimeline: jest.fn().mockResolvedValue([]),
      listStuck: jest.fn().mockResolvedValue([]),
    }
    const controller = new RentalTransactionsController(service as never)

    await controller.getTimeline('application-1', {
      _id: 'tenant-1',
      roles: ['tenant'],
    })

    expect(service.getTimeline).toHaveBeenCalledWith('application-1', {
      id: 'tenant-1',
      roles: ['tenant'],
    })
  })

  it('does not translate a forbidden service response into a successful timeline', async () => {
    const service = {
      getTimeline: jest.fn().mockRejectedValue(new ForbiddenException()),
      listStuck: jest.fn(),
    }
    const controller = new RentalTransactionsController(service as never)

    await expect(
      controller.getTimeline('application-1', {
        _id: 'stranger-1',
        roles: ['tenant'],
      })
    ).rejects.toThrow(ForbiddenException)
  })
})
