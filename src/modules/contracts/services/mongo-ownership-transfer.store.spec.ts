import { MongoClient } from 'mongodb'
import { MongoOwnershipTransferStore } from './mongo-ownership-transfer.store'
import {
  OwnershipTransferApplyConflictError,
  OwnershipTransferTransactionUnavailableError,
} from './ownership-transfer.store'

const TRANSFER_ID = '64b000000000000000000001'
const APARTMENT_ID = '64b000000000000000000002'
const PREVIEW_HASH = `sha256:${'a'.repeat(64)}`

type FindOneMock = jest.MockedFunction<
  (filter: object, options?: object) => Promise<unknown>
>
type UpdateOneMock = jest.MockedFunction<
  (
    filter: object,
    update: object,
    options?: object
  ) => Promise<{ matchedCount: number }>
>

type MockCollection = {
  findOne: FindOneMock
  updateOne: UpdateOneMock
}

type MockSession = {
  withTransaction: jest.MockedFunction<
    (callback: () => Promise<unknown>) => Promise<unknown>
  >
  endSession: jest.MockedFunction<() => Promise<void>>
}

interface StoreFixture {
  store: MongoOwnershipTransferStore
  dataSource: { mongoManager: { mongoQueryRunner: unknown } }
  connectSpy: jest.SpyInstance
  transferCollection: MockCollection
  recordCollection: MockCollection
  apartmentCollection: MockCollection
  session: MockSession
  client: {
    db: jest.MockedFunction<() => unknown>
    startSession: jest.MockedFunction<() => MockSession>
    close: jest.MockedFunction<() => Promise<void>>
  }
}

function createStoreFixture(): StoreFixture {
  const transferCollection: MockCollection = {
    findOne: jest.fn() as FindOneMock,
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1 }) as UpdateOneMock,
  }
  const recordCollection: MockCollection = {
    findOne: jest.fn() as FindOneMock,
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1 }) as UpdateOneMock,
  }
  const apartmentCollection: MockCollection = {
    findOne: jest.fn() as FindOneMock,
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1 }) as UpdateOneMock,
  }
  const database = {
    collection: jest.fn((name: string): MockCollection => {
      if (name === 'property_ownership_transfers') return transferCollection
      if (name === 'property_ownership_transfer_records')
        return recordCollection
      if (name === 'apartments') return apartmentCollection
      throw new Error(`Unexpected collection: ${name}`)
    }),
  }
  const session: MockSession = {
    withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
      callback()
    ),
    endSession: jest
      .fn()
      .mockResolvedValue(undefined) as MockSession['endSession'],
  }
  const client = {
    db: jest.fn(() => database) as jest.MockedFunction<() => unknown>,
    startSession: jest.fn(() => session) as jest.MockedFunction<
      () => MockSession
    >,
    close: jest.fn().mockResolvedValue(undefined) as jest.MockedFunction<
      () => Promise<void>
    >,
  }

  const connectSpy = jest
    .spyOn(MongoClient, 'connect')
    .mockRejectedValue(new Error('MongoClient.connect must not be called'))

  const dataSource = {
    mongoManager: { mongoQueryRunner: { databaseConnection: client } },
  }
  const store = new MongoOwnershipTransferStore(dataSource as never)

  return {
    store,
    dataSource,
    connectSpy,
    transferCollection,
    recordCollection,
    apartmentCollection,
    session,
    client,
  }
}

function baseTransfer(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    _id: { toString: () => TRANSFER_ID },
    previewHash: PREVIEW_HASH,
    status: 'previewed',
    idempotencyKey: null,
    finalReport: null,
    ...overrides,
  }
}

describe('MongoOwnershipTransferStore', () => {
  afterEach(() => jest.restoreAllMocks())

  it('commits apartment and audit updates inside one transaction', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())

    const report = await fixture.store.apply({
      transferId: TRANSFER_ID,
      targetLandlordId: 'target-landlord',
      idempotencyKey: 'request-1',
      expectedPreviewHash: PREVIEW_HASH,
      records: [
        {
          entityType: 'apartment',
          entityId: APARTMENT_ID,
          fromLandlordId: 'source-landlord',
          toLandlordId: 'target-landlord',
          version: 'v1',
        },
        {
          entityType: 'contract',
          entityId: 'contract-1',
          fromLandlordId: 'source-landlord',
          toLandlordId: 'target-landlord',
          version: 'v2',
        },
      ],
    })

    expect(report).toMatchObject({
      updatedApartments: 1,
      preservedContracts: 1,
      auditRecordCount: 2,
    })
    expect(fixture.session.withTransaction).toHaveBeenCalledTimes(1)
    const apartmentUpdateCall =
      fixture.apartmentCollection.updateOne.mock.calls[0]
    expect(apartmentUpdateCall?.[0]).toEqual(
      expect.objectContaining({ landlordId: 'source-landlord' })
    )
    expect(apartmentUpdateCall?.[1]).toEqual({
      $set: {
        landlordId: 'target-landlord',
        ownershipTransferId: TRANSFER_ID,
      },
    })
    const updateOptions = apartmentUpdateCall?.[2] as
      | { session?: unknown }
      | undefined
    expect(updateOptions?.session).toBe(fixture.session)
    expect(fixture.session.endSession).toHaveBeenCalledTimes(1)
  })

  it('returns the original result for the same completed idempotency key', async () => {
    const fixture = createStoreFixture()
    const finalReport = {
      updatedApartments: 1,
      reassignedBookings: 0,
      reassignedApplications: 0,
      preservedContracts: 0,
      preservedDepositAgreements: 0,
      preservedPayments: 0,
      preservedDisputes: 0,
      auditRecordCount: 1,
    }
    fixture.transferCollection.findOne.mockResolvedValue(
      baseTransfer({
        status: 'completed',
        idempotencyKey: 'request-1',
        finalReport,
      })
    )

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-1',
        expectedPreviewHash: PREVIEW_HASH,
        records: [],
      })
    ).resolves.toEqual(finalReport)
    expect(fixture.apartmentCollection.updateOne).not.toHaveBeenCalled()
    expect(fixture.transferCollection.updateOne).not.toHaveBeenCalled()
  })

  it('aborts without business updates when a record changed during apply', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())
    fixture.apartmentCollection.updateOne.mockResolvedValue({ matchedCount: 0 })

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-2',
        expectedPreviewHash: PREVIEW_HASH,
        records: [
          {
            entityType: 'apartment',
            entityId: APARTMENT_ID,
            fromLandlordId: 'source-landlord',
            toLandlordId: 'target-landlord',
            version: 'v1',
          },
        ],
      })
    ).rejects.toBeInstanceOf(OwnershipTransferApplyConflictError)
    expect(fixture.transferCollection.updateOne).not.toHaveBeenCalled()
    expect(fixture.session.endSession).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale preview before any collection mutation', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(
      baseTransfer({ previewHash: `sha256:${'b'.repeat(64)}` })
    )

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-3',
        expectedPreviewHash: PREVIEW_HASH,
        records: [],
      })
    ).rejects.toBeInstanceOf(OwnershipTransferApplyConflictError)
    expect(fixture.transferCollection.updateOne).not.toHaveBeenCalled()
    expect(fixture.apartmentCollection.updateOne).not.toHaveBeenCalled()
  })

  it('fails closed when MongoDB transactions are unavailable', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())
    fixture.session.withTransaction.mockRejectedValue(
      new Error('Transaction numbers are only allowed on a replica set member')
    )

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-4',
        expectedPreviewHash: PREVIEW_HASH,
        records: [],
      })
    ).rejects.toBeInstanceOf(OwnershipTransferTransactionUnavailableError)
    expect(fixture.session.endSession).toHaveBeenCalledTimes(1)
  })

  it('ends sessions on unexpected transaction errors', async () => {
    const fixture = createStoreFixture()
    fixture.session.withTransaction.mockRejectedValue(new Error('write failed'))

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-5',
        expectedPreviewHash: PREVIEW_HASH,
        records: [],
      })
    ).rejects.toThrow('write failed')
    expect(fixture.session.endSession).toHaveBeenCalledTimes(1)
  })

  it('uses the shared TypeORM client and never opens its own connection', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())

    await fixture.store.apply({
      transferId: TRANSFER_ID,
      targetLandlordId: 'target-landlord',
      idempotencyKey: 'request-6',
      expectedPreviewHash: PREVIEW_HASH,
      records: [],
    })

    expect(fixture.client.startSession).toHaveBeenCalledTimes(1)
    expect(fixture.connectSpy).not.toHaveBeenCalled()
  })

  it('fails with a clear error when the shared client is not ready', async () => {
    const fixture = createStoreFixture()
    fixture.dataSource.mongoManager.mongoQueryRunner = undefined

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-7',
        expectedPreviewHash: PREVIEW_HASH,
        records: [],
      })
    ).rejects.toThrow('MongoDB client chưa sẵn sàng')
    expect(fixture.client.startSession).not.toHaveBeenCalled()
  })

  it('rolls back: no completion write when a record update throws mid-transaction', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())
    fixture.apartmentCollection.updateOne.mockRejectedValue(
      new Error('write failed')
    )

    await expect(
      fixture.store.apply({
        transferId: TRANSFER_ID,
        targetLandlordId: 'target-landlord',
        idempotencyKey: 'request-8',
        expectedPreviewHash: PREVIEW_HASH,
        records: [
          {
            entityType: 'apartment',
            entityId: APARTMENT_ID,
            fromLandlordId: 'source-landlord',
            toLandlordId: 'target-landlord',
            version: 'v1',
          },
        ],
      })
    ).rejects.toThrow('write failed')
    expect(fixture.transferCollection.updateOne).not.toHaveBeenCalled()
    expect(fixture.recordCollection.updateOne).not.toHaveBeenCalled()
    expect(fixture.session.endSession).toHaveBeenCalledTimes(1)
  })

  it('has no module-destroy hook and never closes the shared client', async () => {
    const fixture = createStoreFixture()
    fixture.transferCollection.findOne.mockResolvedValue(baseTransfer())
    await fixture.store.apply({
      transferId: TRANSFER_ID,
      targetLandlordId: 'target-landlord',
      idempotencyKey: 'request-9',
      expectedPreviewHash: PREVIEW_HASH,
      records: [],
    })

    expect(fixture.store).not.toHaveProperty('onModuleDestroy')
    expect(fixture.client.close).not.toHaveBeenCalled()
  })
})
