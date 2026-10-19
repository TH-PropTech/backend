import { DepositAgreementsController } from './deposit-agreements.controller'

describe('DepositAgreementsController', () => {
  it('passes JWT tenant identity to consent', async () => {
    const service = {
      consent: jest.fn().mockResolvedValue({ status: 'accepted' }),
    }
    const controller = new DepositAgreementsController(service as never)

    await controller.consent(
      '507f1f77bcf86cd799439011',
      {
        expectedRevision: 1,
        expectedContentHash: 'a'.repeat(64),
      },
      'tenant-1'
    )

    expect(service.consent).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      'tenant-1',
      1,
      'a'.repeat(64)
    )
  })
})
