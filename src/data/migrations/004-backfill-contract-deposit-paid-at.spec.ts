import { ObjectId } from 'mongodb'
import { backfillContractDepositPaidAt } from './004-backfill-contract-deposit-paid-at'

describe('backfillContractDepositPaidAt', () => {
  it('backfills only confirmed agreements and remains idempotent on a second run', async () => {
    const paidAt = new Date('2026-09-27T00:00:00.000Z')
    const agreementId = new ObjectId()
    const contract = {
      depositAgreementId: agreementId.toHexString(),
      depositPaidAt: null as Date | null,
    }
    const contractRepository = {
      find: jest.fn().mockResolvedValue([contract]),
      save: jest.fn((value: typeof contract) => Promise.resolve(value)),
    }
    const depositAgreementRepository = {
      find: jest.fn().mockResolvedValue([
        {
          _id: agreementId,
          status: 'paid',
          paidAt,
        },
      ]),
      save: jest.fn(),
    }
    const repositories = { contractRepository, depositAgreementRepository }

    const first = await backfillContractDepositPaidAt(repositories)
    const second = await backfillContractDepositPaidAt(repositories)

    expect(first.updated).toBe(1)
    expect(contract.depositPaidAt).toEqual(paidAt)
    expect(second.updated).toBe(0)
    expect(contractRepository.save).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an existing contract depositPaidAt', async () => {
    const existingPaidAt = new Date('2026-09-20T00:00:00.000Z')
    const agreementId = new ObjectId()
    const contract = {
      depositAgreementId: agreementId.toHexString(),
      depositPaidAt: existingPaidAt,
    }
    const contractRepository = {
      find: jest.fn().mockResolvedValue([contract]),
      save: jest.fn(),
    }
    const depositAgreementRepository = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            _id: agreementId,
            status: 'applied-to-lease-security',
            paidAt: new Date(),
          },
        ]),
      save: jest.fn(),
    }

    await backfillContractDepositPaidAt({
      contractRepository,
      depositAgreementRepository,
    })

    expect(contract.depositPaidAt).toEqual(existingPaidAt)
    expect(contractRepository.save).not.toHaveBeenCalled()
  })
})
