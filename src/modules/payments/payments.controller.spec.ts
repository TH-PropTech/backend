import { BadRequestException } from '@nestjs/common'
import { PaymentsController } from './payments.controller'
import type { PaymentsService } from './payments.service'

describe('PaymentsController', () => {
  const service = {
    getByContract: jest.fn(),
    confirmPayment: jest.fn(),
  }
  const controller = new PaymentsController(
    service as unknown as PaymentsService
  )

  beforeEach(() => jest.clearAllMocks())

  it('passes the JWT identity and staff relationship to schedule reads', async () => {
    service.getByContract.mockResolvedValue([])
    await controller.getByContract('contract-1', {
      _id: 'staff-1',
      roles: ['staff'],
    })

    expect(service.getByContract).toHaveBeenCalledWith(
      'contract-1',
      'staff-1',
      true
    )
  })

  it('requires a contract id and authenticated identity', () => {
    expect(() => controller.getByContract('', {})).toThrow(BadRequestException)
  })

  it('delegates manual confirmation to the service', async () => {
    service.confirmPayment.mockResolvedValue({ status: 'paid' })
    await controller.confirm('payment-1', 'staff-1')
    expect(service.confirmPayment).toHaveBeenCalledWith(
      'payment-1',
      'staff-1',
      true
    )
  })
})
