import { ObjectId } from 'mongodb'
import {
  DepositConfirmationResolver,
  resolveDepositConfirmation,
} from './deposit-confirmation.resolver'
import type { DepositAgreement } from '../schemas/deposit-agreement.schema'

describe('resolveDepositConfirmation (pure)', () => {
  it('cọc bằng 0: không yêu cầu và luôn coi là đã xác nhận', () => {
    const result = resolveDepositConfirmation(
      { deposit: 0, depositPaidAt: null },
      null
    )
    expect(result).toMatchObject({
      required: false,
      requiredAmount: 0,
      confirmed: true,
      source: 'not-required',
    })
  })

  it('agreement ở trạng thái paid: đã xác nhận dù depositPaidAt chưa được ghi', () => {
    const result = resolveDepositConfirmation(
      { deposit: 20_000_000, depositPaidAt: null },
      {
        id: 'agreement-1',
        status: 'paid',
        amount: 20_000_000,
        paidAt: new Date('2026-09-01T00:00:00.000Z'),
      }
    )
    expect(result).toMatchObject({
      required: true,
      requiredAmount: 20_000_000,
      confirmed: true,
      source: 'agreement',
      agreementId: 'agreement-1',
      agreementStatus: 'paid',
    })
  })

  it('agreement ở trạng thái applied-to-lease-security: đã xác nhận', () => {
    const result = resolveDepositConfirmation(
      { deposit: 20_000_000, depositPaidAt: null },
      {
        id: 'agreement-1',
        status: 'applied-to-lease-security',
        amount: 20_000_000,
        paidAt: new Date('2026-09-01T00:00:00.000Z'),
      }
    )
    expect(result.confirmed).toBe(true)
    expect(result.source).toBe('agreement')
  })

  it('chỉ có contract.depositPaidAt (không có agreement đã xác nhận): đã xác nhận qua contract-field', () => {
    const result = resolveDepositConfirmation(
      {
        deposit: 20_000_000,
        depositPaidAt: new Date('2026-09-02T00:00:00.000Z'),
      },
      null
    )
    expect(result).toMatchObject({
      required: true,
      confirmed: true,
      source: 'contract-field',
    })
  })

  it('agreement ở trạng thái accepted (chưa trả): chưa xác nhận', () => {
    const result = resolveDepositConfirmation(
      { deposit: 20_000_000, depositPaidAt: null },
      {
        id: 'agreement-1',
        status: 'accepted',
        amount: 20_000_000,
        paidAt: null,
      }
    )
    expect(result).toMatchObject({
      confirmed: false,
      source: 'agreement',
      agreementStatus: 'accepted',
    })
  })

  it('thiếu agreement và chưa có depositPaidAt: chưa xác nhận', () => {
    const result = resolveDepositConfirmation(
      { deposit: 20_000_000, depositPaidAt: null },
      null
    )
    expect(result).toMatchObject({
      required: true,
      confirmed: false,
      source: 'contract-field',
      agreementId: null,
    })
  })
})

describe('DepositConfirmationResolver (class wrapper)', () => {
  function buildAgreement(
    overrides: Partial<DepositAgreement> = {}
  ): DepositAgreement {
    return {
      _id: new ObjectId(),
      status: 'paid',
      amount: 20_000_000,
      paidAt: new Date('2026-09-01T00:00:00.000Z'),
      ...overrides,
    } as DepositAgreement
  }

  it('tra cứu theo depositAgreementId trước, rồi mới tới rentalApplicationId', async () => {
    const agreement = buildAgreement()
    const findOne = jest.fn().mockResolvedValueOnce(agreement)
    const resolver = new DepositConfirmationResolver({
      findOne,
    } as never)

    const result = await resolver.resolve({
      deposit: 20_000_000,
      depositPaidAt: null,
      depositAgreementId: agreement._id.toHexString(),
      rentalApplicationId: 'app-1',
    })

    expect(findOne).toHaveBeenCalledTimes(1)
    expect(findOne).toHaveBeenCalledWith({
      where: { _id: agreement._id },
    })
    expect(result.confirmed).toBe(true)
    expect(result.agreementId).toBe(agreement._id.toHexString())
  })

  it('rơi về tra cứu theo rentalApplicationId khi thiếu depositAgreementId hợp lệ', async () => {
    const agreement = buildAgreement({ status: 'accepted', paidAt: null })
    const findOne = jest.fn().mockResolvedValueOnce(agreement)
    const resolver = new DepositConfirmationResolver({
      findOne,
    } as never)

    const result = await resolver.resolve({
      deposit: 20_000_000,
      depositPaidAt: null,
      depositAgreementId: null,
      rentalApplicationId: 'app-1',
    })

    expect(findOne).toHaveBeenCalledWith({
      where: { applicationId: 'app-1' },
    })
    expect(result.confirmed).toBe(false)
  })

  it('không có thỏa thuận cọc nào: chưa xác nhận', async () => {
    const findOne = jest.fn().mockResolvedValue(null)
    const resolver = new DepositConfirmationResolver({
      findOne,
    } as never)

    const result = await resolver.resolve({
      deposit: 20_000_000,
      depositPaidAt: null,
      depositAgreementId: null,
      rentalApplicationId: null,
    })

    expect(result.confirmed).toBe(false)
    expect(result.agreementId).toBeNull()
  })
})
