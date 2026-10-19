import { NotFoundException } from '@nestjs/common'
import { AdminPaymentsController } from './admin-payments.controller'

function setup(): {
  controller: AdminPaymentsController
  service: Record<'list' | 'recheck', jest.Mock>
} {
  const service = {
    list: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    recheck: jest.fn().mockResolvedValue({ txRef: 'TX-1' }),
  }
  return { controller: new AdminPaymentsController(service as never), service }
}

describe('AdminPaymentsController', () => {
  it('parses query params before delegating to the service', async () => {
    const { controller, service } = setup()

    await controller.list(
      '2',
      '10',
      'momo',
      'succeeded',
      'failed',
      '2026-01-01',
      '2026-01-31',
      'TX-1'
    )

    expect(service.list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      provider: 'momo',
      status: 'succeeded',
      payoutStatus: 'failed',
      from: new Date('2026-01-01'),
      to: new Date('2026-01-31'),
      q: 'TX-1',
    })
  })

  it('omits filters that were not passed', async () => {
    const { controller, service } = setup()

    await controller.list()

    expect(service.list).toHaveBeenCalledWith({})
  })

  it('returns the rechecked row', async () => {
    const { controller, service } = setup()

    await expect(controller.recheck('TX-1')).resolves.toEqual({ txRef: 'TX-1' })
    expect(service.recheck).toHaveBeenCalledWith('TX-1')
  })

  it('throws 404 when the txRef is unknown', async () => {
    const { controller, service } = setup()
    service.recheck.mockResolvedValue(null)

    await expect(controller.recheck('missing')).rejects.toBeInstanceOf(
      NotFoundException
    )
  })
})
