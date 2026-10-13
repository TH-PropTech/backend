import { ObjectId } from 'mongodb'
import { RentalTransactionEventService } from './rental-transaction-event.service'
import { RentalTransactionEvent } from '../schemas/rental-transaction-event.schema'

describe('RentalTransactionEventService', () => {
  let service: RentalTransactionEventService
  let repository: {
    findOne: jest.Mock
    create: jest.Mock
    save: jest.Mock
  }

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(
        (input: object): RentalTransactionEvent =>
          ({
            _id: new ObjectId(),
            ...input,
          }) as RentalTransactionEvent
      ),
      save: jest.fn((event: RentalTransactionEvent) => Promise.resolve(event)),
    }
    service = new RentalTransactionEventService(repository as never)
  })

  it('records a sanitized append-only event with safe references', async () => {
    const event = await service.record({
      transactionKey: 'application-1',
      transitionKey: 'application-1:consent:1',
      contractId: 'contract-1',
      eventType: 'deposit.consent.created',
      actorRole: 'tenant',
      actorId: 'tenant-1',
      reasonCode: 'CONSENTED',
      refs: {
        contractId: 'contract-1',
        paymentId: 'payment-1',
        idCardNumber: '079123456789',
        smartCaPassword: 'secret',
      },
    })

    expect(event.transitionKey).toBe('application-1:consent:1')
    expect(event.refs).toEqual({
      contractId: 'contract-1',
      paymentId: 'payment-1',
    })
    expect(JSON.stringify(event)).not.toContain('079123456789')
    expect(JSON.stringify(event)).not.toContain('secret')
    expect(repository.save).toHaveBeenCalledWith(event)
  })

  it('drops every ref key outside the safe allowlist, even newly invented sensitive keys', async () => {
    const event = await service.record({
      transactionKey: 'application-2',
      transitionKey: 'application-2:signed:tenant',
      eventType: 'contract.signed',
      actorRole: 'tenant',
      reasonCode: 'VALIDATION_FAILED',
      refs: {
        applicationId: 'application-2',
        otpCode: '123456',
        smartCaSad: 'abcd',
        bankAccountNumber: '0123456789012',
        biometricTemplate: 'base64-face-vector',
        rawContractContent: '<html>full contract body</html>',
      },
    })

    expect(event.refs).toEqual({ applicationId: 'application-2' })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('otpCode')
    expect(serialized).not.toContain('smartCaSad')
    expect(serialized).not.toContain('bankAccountNumber')
    expect(serialized).not.toContain('biometricTemplate')
    expect(serialized).not.toContain('rawContractContent')
    expect(serialized).not.toContain('0123456789012')
    expect(serialized).not.toContain('base64-face-vector')
    expect(serialized).not.toContain('<html>')
  })

  it('strips newlines and caps the length of a reasonCode supplied by a caller', async () => {
    const longReason = `line-one\nline-two ${'x'.repeat(300)}`
    const event = await service.record({
      transactionKey: 'application-3',
      transitionKey: 'application-3:activation-failed',
      eventType: 'contract.activation-failed',
      actorRole: 'system',
      reasonCode: longReason,
    })

    expect(event.reasonCode).not.toContain('\n')
    expect((event.reasonCode ?? '').length).toBeLessThanOrEqual(160)
  })

  it('returns the existing event for duplicate transition keys', async () => {
    const existing = { _id: new ObjectId(), transitionKey: 'same-key' }
    repository.findOne.mockResolvedValue(existing)

    const result = await service.record({
      transactionKey: 'application-1',
      transitionKey: 'same-key',
      eventType: 'signature.completed',
      actorRole: 'system',
    })

    expect(result).toBe(existing)
    expect(repository.create).not.toHaveBeenCalled()
    expect(repository.save).not.toHaveBeenCalled()
  })

  it('returns the unique event when concurrent insertion races on the index', async () => {
    const raced = { _id: new ObjectId(), transitionKey: 'race-key' }
    repository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(raced)
    repository.save.mockRejectedValue(new Error('duplicate key'))

    await expect(
      service.record({
        transactionKey: 'application-1',
        transitionKey: 'race-key',
        eventType: 'ledger.enqueued',
        actorRole: 'system',
      })
    ).resolves.toBe(raced)
  })
})
