import { ObjectId } from 'mongodb'
import { LedgerProjectionService } from './ledger-projection.service'
import { LedgerOutbox } from './schemas/ledger-outbox.schema'

describe('LedgerProjectionService', () => {
  let service: LedgerProjectionService
  let contractRepo: {
    findOne: jest.Mock
    save: jest.Mock
  }
  let depositRepo: {
    findOne: jest.Mock
    save: jest.Mock
  }
  let paymentRepo: {
    findOne: jest.Mock
    save: jest.Mock
  }

  beforeEach(() => {
    contractRepo = {
      findOne: jest.fn(),
      save: jest.fn(doc => Promise.resolve(doc)),
    }
    depositRepo = {
      findOne: jest.fn(),
      save: jest.fn(doc => Promise.resolve(doc)),
    }
    paymentRepo = {
      findOne: jest.fn(),
      save: jest.fn(doc => Promise.resolve(doc)),
    }
    service = new LedgerProjectionService(
      contractRepo as never,
      depositRepo as never,
      paymentRepo as never
    )
  })

  it('projects contract activation confirmation to Contract entity', async () => {
    const contractId = new ObjectId()
    const contract = {
      _id: contractId,
      blockchainAddress: null,
      ledgerStatus: null,
      ledgerNetworkMode: null,
      ledgerRecordedAt: null,
    }
    contractRepo.findOne.mockResolvedValue(contract)

    const event = {
      _id: new ObjectId(),
      aggregateType: 'contract',
      aggregateId: contractId.toHexString(),
      eventType: 'contract.activated',
    } as LedgerOutbox

    await service.projectResult(event, {
      txHash: 'fabric-tx-contract-1',
      blockNumber: null,
      networkMode: 'fabric',
    })

    expect(contractRepo.findOne).toHaveBeenCalledWith({
      where: { _id: contractId },
    })
    expect(contractRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        blockchainAddress: 'fabric-tx-contract-1',
        ledgerStatus: 'confirmed',
        ledgerNetworkMode: 'fabric',
      })
    )
  })

  it('projects deposit paid confirmation to DepositAgreement entity', async () => {
    const depositId = new ObjectId()
    const deposit = {
      _id: depositId,
      depositLedgerTxId: null,
      ledgerStatus: null,
      ledgerRecordedAt: null,
    }
    depositRepo.findOne.mockResolvedValue(deposit)

    const event = {
      _id: new ObjectId(),
      aggregateType: 'deposit',
      aggregateId: depositId.toHexString(),
      eventType: 'deposit.paid',
    } as LedgerOutbox

    await service.projectResult(event, {
      txHash: 'fabric-tx-deposit-1',
      networkMode: 'fabric',
    })

    expect(depositRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        depositLedgerTxId: 'fabric-tx-deposit-1',
        ledgerStatus: 'confirmed',
      })
    )
  })

  it('projects payment paid confirmation to Payment entity', async () => {
    const paymentId = new ObjectId()
    const payment = {
      _id: paymentId,
      txHash: null,
      ledgerStatus: null,
      ledgerNetworkMode: null,
      ledgerRecordedAt: null,
    }
    paymentRepo.findOne.mockResolvedValue(payment)

    const event = {
      _id: new ObjectId(),
      aggregateType: 'payment',
      aggregateId: paymentId.toHexString(),
      eventType: 'payment.paid',
    } as LedgerOutbox

    await service.projectResult(event, {
      txHash: 'fabric-tx-payment-1',
      networkMode: 'fabric',
    })

    expect(paymentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: 'fabric-tx-payment-1',
        ledgerStatus: 'confirmed',
        ledgerNetworkMode: 'fabric',
      })
    )
  })

  it('handles missing or unsupported aggregate gracefully without error', async () => {
    const event = {
      _id: new ObjectId(),
      aggregateType: 'unknown',
      aggregateId: new ObjectId().toHexString(),
      eventType: 'custom.event',
    } as LedgerOutbox

    await expect(
      service.projectResult(event, { txHash: 'tx-1' })
    ).resolves.not.toThrow()
    expect(contractRepo.save).not.toHaveBeenCalled()
  })
})
