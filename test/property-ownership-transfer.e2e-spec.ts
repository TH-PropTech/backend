import { MongoClient, ObjectId, type Db } from 'mongodb'
import type { ConfigService } from '@nestjs/config'
import { MongoOwnershipTransferStore } from '../src/modules/contracts/services/mongo-ownership-transfer.store'
import type { OwnershipTransferManifestRecord } from '../src/modules/contracts/utils/ownership-transfer.manifest'

const transactionMongoUri = process.env.OWNERSHIP_TRANSFER_MONGO_URI
const describeTransactionIntegration = transactionMongoUri
  ? describe
  : describe.skip

describeTransactionIntegration(
  'ownership transfer MongoDB transaction integration',
  () => {
    let client: MongoClient
    let database: Db
    let store: MongoOwnershipTransferStore

    beforeAll(async () => {
      if (!transactionMongoUri) return

      client = await MongoClient.connect(transactionMongoUri)
      database = client.db(
        `th_proptech_ownership_transfer_${Date.now().toString(36)}`
      )
      store = new MongoOwnershipTransferStore({
        getOrThrow: (): string => transactionMongoUri,
      } as unknown as ConfigService)
    })

    afterAll(async () => {
      await database?.dropDatabase()
      await client?.close()
      await store?.onModuleDestroy()
    })

    it('applies operational ownership while preserving immutable records and supports idempotent retry', async () => {
      const transferId = new ObjectId()
      const apartmentId = new ObjectId()
      const bookingId = new ObjectId()
      const applicationId = new ObjectId()
      const contractId = new ObjectId()
      const depositAgreementId = new ObjectId()
      const paymentId = new ObjectId()
      const disputeId = new ObjectId()
      const sourceLandlordId = 'source-landlord'
      const targetLandlordId = 'target-landlord'
      const previewHash = `sha256:${'a'.repeat(64)}`
      const transferIdString = transferId.toHexString()

      await database.collection('property_ownership_transfers').insertOne({
        _id: transferId,
        previewHash,
        status: 'previewed',
        idempotencyKey: null,
      })
      await database.collection('apartments').insertOne({
        _id: apartmentId,
        landlordId: sourceLandlordId,
      })
      await database.collection('bookings').insertOne({
        _id: bookingId,
        landlordId: sourceLandlordId,
      })
      await database.collection('rental_applications').insertOne({
        _id: applicationId,
        landlordId: sourceLandlordId,
      })
      await database.collection('contracts').insertOne({
        _id: contractId,
        landlordId: sourceLandlordId,
      })
      await database.collection('deposit_agreements').insertOne({
        _id: depositAgreementId,
        landlordId: sourceLandlordId,
      })
      await database.collection('payments').insertOne({
        _id: paymentId,
        landlordId: sourceLandlordId,
      })
      await database.collection('disputes').insertOne({
        _id: disputeId,
        landlordId: sourceLandlordId,
      })

      const records: OwnershipTransferManifestRecord[] = [
        {
          entityType: 'apartment',
          entityId: apartmentId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'booking',
          entityId: bookingId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'rentalApplication',
          entityId: applicationId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'contract',
          entityId: contractId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'depositAgreement',
          entityId: depositAgreementId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'payment',
          entityId: paymentId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
        {
          entityType: 'dispute',
          entityId: disputeId.toHexString(),
          fromLandlordId: sourceLandlordId,
          toLandlordId: targetLandlordId,
          version: 'v1',
        },
      ]

      const result = await store.apply({
        transferId: transferIdString,
        targetLandlordId,
        idempotencyKey: 'integration-request-1',
        expectedPreviewHash: previewHash,
        records,
      })

      expect(result).toEqual({
        updatedApartments: 1,
        reassignedBookings: 1,
        reassignedApplications: 1,
        preservedContracts: 1,
        preservedDepositAgreements: 1,
        preservedPayments: 1,
        preservedDisputes: 1,
        auditRecordCount: 7,
      })
      await expect(
        database.collection('apartments').findOne({ _id: apartmentId })
      ).resolves.toMatchObject({
        landlordId: targetLandlordId,
        ownershipTransferId: transferIdString,
      })
      await expect(
        database.collection('bookings').findOne({ _id: bookingId })
      ).resolves.toMatchObject({
        landlordId: targetLandlordId,
        originalLandlordId: sourceLandlordId,
        ownershipTransferId: transferIdString,
      })
      await expect(
        database
          .collection('rental_applications')
          .findOne({ _id: applicationId })
      ).resolves.toMatchObject({
        landlordId: targetLandlordId,
        originalLandlordId: sourceLandlordId,
        ownershipTransferId: transferIdString,
      })
      await expect(
        database.collection('contracts').findOne({ _id: contractId })
      ).resolves.toMatchObject({ landlordId: sourceLandlordId })
      await expect(
        database.collection('deposit_agreements').findOne({
          _id: depositAgreementId,
        })
      ).resolves.toMatchObject({ landlordId: sourceLandlordId })
      await expect(
        database.collection('payments').findOne({ _id: paymentId })
      ).resolves.toMatchObject({ landlordId: sourceLandlordId })
      await expect(
        database.collection('disputes').findOne({ _id: disputeId })
      ).resolves.toMatchObject({ landlordId: sourceLandlordId })

      await expect(
        database
          .collection('property_ownership_transfer_records')
          .countDocuments({ transferId: transferIdString })
      ).resolves.toBe(7)

      await expect(
        store.apply({
          transferId: transferIdString,
          targetLandlordId,
          idempotencyKey: 'integration-request-1',
          expectedPreviewHash: previewHash,
          records,
        })
      ).resolves.toEqual(result)
    })

    it('aborts the transaction when an operational record no longer matches the preview owner', async () => {
      const transferId = new ObjectId()
      const apartmentId = new ObjectId()
      const previewHash = `sha256:${'b'.repeat(64)}`

      await database.collection('property_ownership_transfers').insertOne({
        _id: transferId,
        previewHash,
        status: 'previewed',
        idempotencyKey: null,
      })
      await database.collection('apartments').insertOne({
        _id: apartmentId,
        landlordId: 'already-changed',
      })

      await expect(
        store.apply({
          transferId: transferId.toHexString(),
          targetLandlordId: 'target-landlord',
          idempotencyKey: 'integration-request-2',
          expectedPreviewHash: previewHash,
          records: [
            {
              entityType: 'apartment',
              entityId: apartmentId.toHexString(),
              fromLandlordId: 'source-landlord',
              toLandlordId: 'target-landlord',
              version: 'v1',
            },
          ],
        })
      ).rejects.toThrow('Ownership transfer record changed')

      await expect(
        database.collection('property_ownership_transfers').findOne({
          _id: transferId,
        })
      ).resolves.toMatchObject({ status: 'previewed' })
      await expect(
        database
          .collection('property_ownership_transfer_records')
          .countDocuments({ transferId: transferId.toHexString() })
      ).resolves.toBe(0)
    })
  }
)
