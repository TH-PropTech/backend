import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { MockBankController } from './mock-bank.controller'

const headers = {
  'x-bank-timestamp': '1000',
  'x-bank-nonce': 'nonce',
  'x-bank-signature': 'signature',
}
const mappedHeaders = {
  timestamp: '1000',
  nonce: 'nonce',
  signature: 'signature',
}

function createController(
  service: object = {},
  registry: object = {},
  gateway: object = {},
  payouts: object = {}
): MockBankController {
  return new MockBankController(
    service as never,
    registry as never,
    gateway as never,
    payouts as never
  )
}

function fakeResponse(): {
  redirect: jest.Mock
  status: jest.Mock
  json: jest.Mock
  end: jest.Mock
} {
  const response = {
    redirect: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
    end: jest.fn(),
  }
  response.status.mockReturnValue(response)
  return response
}

describe('MockBankController', () => {
  it('returns a payment result through the authenticated service boundary', async () => {
    const result = { txRef: 'MOMO-1', targetPaid: true }
    const service = {
      getGatewayPaymentResult: jest.fn().mockResolvedValue(result),
    }

    await expect(
      createController(service).paymentResult('MOMO-1', 'tenant-1')
    ).resolves.toEqual(result)
    expect(service.getGatewayPaymentResult).toHaveBeenCalledWith(
      'MOMO-1',
      'tenant-1'
    )
  })

  it('maps bank headers to the service callback contract', async () => {
    const service = {
      handleRentCallback: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    }

    await createController(service).callbackRent(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      headers
    )

    expect(service.handleRentCallback).toHaveBeenCalledWith(
      { txRef: 'tx-1', amount: 100, status: 'success' },
      mappedHeaders
    )
  })

  it('forwards the chosen gateway, channel and client IP on every init', async () => {
    const service = {
      initDepositPayment: jest.fn().mockResolvedValue({}),
      initRentPayment: jest.fn().mockResolvedValue({}),
      initSettlementPayment: jest.fn().mockResolvedValue({}),
      initInvoicePayment: jest.fn().mockResolvedValue({}),
    }
    const controller = createController(service)
    const choice = {
      provider: 'momo' as const,
      clientChannel: 'mobile' as const,
    }
    const options = { ...choice, clientIp: '10.0.0.9' }

    await controller.initDeposit(
      { depositAgreementId: 'dep-1', ...choice },
      'tenant-1',
      '10.0.0.9'
    )
    await controller.initRent(
      { paymentId: 'pay-1', ...choice },
      'tenant-1',
      '10.0.0.9'
    )
    await controller.initSettlement(
      { settlementId: 'stl-1', ...choice },
      'tenant-1',
      '10.0.0.9'
    )
    await controller.initInvoice(
      { paymentId: 'inv-1', ...choice },
      'landlord-1',
      '10.0.0.9'
    )

    expect(service.initDepositPayment).toHaveBeenCalledWith(
      'dep-1',
      'tenant-1',
      options
    )
    expect(service.initRentPayment).toHaveBeenCalledWith(
      'pay-1',
      'tenant-1',
      options
    )
    expect(service.initSettlementPayment).toHaveBeenCalledWith(
      'stl-1',
      'tenant-1',
      options
    )
    expect(service.initInvoicePayment).toHaveBeenCalledWith(
      'inv-1',
      'landlord-1',
      options
    )
  })

  it('maps settlement and invoice callbacks to their service flows', async () => {
    const service = {
      handleSettlementCallback: jest.fn().mockResolvedValue({}),
      handleInvoiceCallback: jest.fn().mockResolvedValue({}),
    }
    const controller = createController(service)
    const body = { txRef: 'tx-1', amount: 100, status: 'success' as const }

    await controller.callbackSettlement(body, headers)
    await controller.callbackInvoice(body, headers)

    expect(service.handleSettlementCallback).toHaveBeenCalledWith(
      body,
      mappedHeaders
    )
    expect(service.handleInvoiceCallback).toHaveBeenCalledWith(
      body,
      mappedHeaders
    )
  })

  it('rejects wallet access when the JWT has no user id', () => {
    expect(() => createController().wallet({})).toThrow('USER_ID_REQUIRED')
  })

  it('lists enabled providers from the registry', () => {
    const listed = [{ provider: 'vnpay', label: 'VNPAY', simulation: false }]
    const registry = { listProviders: jest.fn().mockReturnValue(listed) }

    expect(createController({}, registry).providers()).toBe(listed)
  })

  it.each([
    ['vnpayReturn', 'vnpay'],
    ['momoReturn', 'momo'],
    ['zalopayReturn', 'zalopay'],
  ] as const)(
    '%s redirects to the server-built client URL',
    async (method, provider) => {
      const gateway = {
        handleReturn: jest
          .fn()
          .mockResolvedValue(
            'http://localhost:3000/contracts/c-1?payment=succeeded'
          ),
      }
      const response = fakeResponse()

      await createController({}, {}, gateway)[method](
        { q: '1' },
        response as never
      )

      expect(gateway.handleReturn).toHaveBeenCalledWith(provider, { q: '1' })
      expect(response.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:3000/contracts/c-1?payment=succeeded'
      )
    }
  )

  it('answers VNPAY IPN with the raw RspCode body (no envelope)', async () => {
    const result = { ok: true, outcome: 'settled' }
    const gateway = {
      handleNotify: jest.fn().mockResolvedValue(result),
      toVnpayAck: jest
        .fn()
        .mockReturnValue({ RspCode: '00', Message: 'Confirm Success' }),
    }
    const response = fakeResponse()

    await createController({}, {}, gateway).vnpayIpn(
      { vnp_TxnRef: 'V-1' },
      response as never
    )

    expect(gateway.handleNotify).toHaveBeenCalledWith('vnpay', {
      vnp_TxnRef: 'V-1',
    })
    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith({
      RspCode: '00',
      Message: 'Confirm Success',
    })
  })

  it('answers MoMo IPN with the mapped status code and no body', async () => {
    const gateway = {
      handleNotify: jest.fn().mockResolvedValue({ ok: true }),
      toMomoStatus: jest.fn().mockReturnValue(204),
    }
    const response = fakeResponse()

    await createController({}, {}, gateway).momoIpn(
      { orderId: 'M-1' },
      response as never
    )

    expect(gateway.handleNotify).toHaveBeenCalledWith('momo', {
      orderId: 'M-1',
    })
    expect(response.status).toHaveBeenCalledWith(204)
    expect(response.end).toHaveBeenCalled()
  })

  it('answers ZaloPay callback with the raw return_code body', async () => {
    const gateway = {
      handleNotify: jest.fn().mockResolvedValue({ ok: false }),
      toZalopayAck: jest
        .fn()
        .mockReturnValue({ return_code: -1, return_message: 'mac not equal' }),
    }
    const response = fakeResponse()

    await createController({}, {}, gateway).zalopayCallback(
      { data: '{}', mac: 'x' },
      response as never
    )

    expect(gateway.handleNotify).toHaveBeenCalledWith('zalopay', {
      data: '{}',
      mac: 'x',
    })
    expect(response.json).toHaveBeenCalledWith({
      return_code: -1,
      return_message: 'mac not equal',
    })
  })

  it('settles a payout as success for the authenticated landlord', async () => {
    const settled = { payout: { status: 'paid-out' }, replayed: false }
    const payouts = { settleForLandlord: jest.fn().mockResolvedValue(settled) }

    await expect(
      createController({}, {}, {}, payouts).payoutSuccess('PAYOUT-1', {
        _id: 'landlord-1',
      })
    ).resolves.toBe(settled)
    expect(payouts.settleForLandlord).toHaveBeenCalledWith(
      'PAYOUT-1',
      'success',
      'landlord-1'
    )
  })

  it('settles a payout as failed for the authenticated landlord', async () => {
    const payouts = {
      settleForLandlord: jest
        .fn()
        .mockResolvedValue({ payout: { status: 'failed' }, replayed: false }),
    }

    await createController({}, {}, {}, payouts).payoutFailed('PAYOUT-1', {
      _id: 'landlord-1',
    })

    expect(payouts.settleForLandlord).toHaveBeenCalledWith(
      'PAYOUT-1',
      'failed',
      'landlord-1'
    )
  })

  it('rejects payout results when the token has no user id', () => {
    const payouts = { settleForLandlord: jest.fn() }
    const controller = createController({}, {}, {}, payouts)

    expect(() => controller.payoutSuccess('PAYOUT-1', {})).toThrow(
      'USER_ID_REQUIRED'
    )
    expect(() => controller.payoutFailed('PAYOUT-1', {})).toThrow(
      'USER_ID_REQUIRED'
    )
    expect(payouts.settleForLandlord).not.toHaveBeenCalled()
  })

  it('rejects payout simulation for a non-simulation wallet', async () => {
    const payouts = {
      settleForLandlord: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('PAYOUT_SIMULATION_ONLY')),
    }

    await expect(
      createController({}, {}, {}, payouts).payoutSuccess('PAYOUT-1', {
        _id: 'landlord-1',
      })
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('returns not found for an unknown payout reference', async () => {
    const payouts = {
      settleForLandlord: jest
        .fn()
        .mockRejectedValue(new NotFoundException('PAYOUT_NOT_FOUND')),
    }

    await expect(
      createController({}, {}, {}, payouts).payoutFailed('PAYOUT-X', {
        _id: 'landlord-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
