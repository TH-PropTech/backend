import { MockBankController } from './mock-bank.controller'

describe('MockBankController', () => {
  it('maps bank headers to the service callback contract', async () => {
    const service = {
      handleRentCallback: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    }
    const controller = new MockBankController(service as never)

    await controller.callbackRent(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      {
        'x-bank-timestamp': '1000',
        'x-bank-nonce': 'nonce',
        'x-bank-signature': 'signature',
      }
    )

    expect(service.handleRentCallback).toHaveBeenCalledWith(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      { timestamp: '1000', nonce: 'nonce', signature: 'signature' }
    )
  })

  it('rejects wallet access when the JWT has no user id', () => {
    const controller = new MockBankController({} as never)
    expect(() => controller.wallet({})).toThrow('USER_ID_REQUIRED')
  })
})
