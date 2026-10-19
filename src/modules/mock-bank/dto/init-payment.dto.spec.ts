import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { InitRentPaymentDto } from './init-payment.dto'

const PAYMENT_ID = '507f1f77bcf86cd799439011'

async function errorsFor(body: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(
    plainToInstance(InitRentPaymentDto, { paymentId: PAYMENT_ID, ...body })
  )
  return errors.map(error => error.property)
}

describe('PaymentInitChoiceDto brand', () => {
  it('accepts a missing brand and every supported brand', async () => {
    await expect(errorsFor({})).resolves.toEqual([])
    for (const brand of ['mocbank', 'momo', 'zalopay']) {
      await expect(errorsFor({ brand })).resolves.toEqual([])
    }
  })

  it('rejects an unknown brand', async () => {
    await expect(errorsFor({ brand: 'paypal' })).resolves.toEqual(['brand'])
  })
})
