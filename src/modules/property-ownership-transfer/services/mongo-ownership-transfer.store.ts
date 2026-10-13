import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { MongoClient, ObjectId, type ClientSession } from 'mongodb'
import type { OwnershipTransferManifestRecord } from '../utils/ownership-transfer.manifest'
import type { OwnershipTransferFinalReport } from '../schemas/property-ownership-transfer.schema'
import {
  OwnershipTransferApplyConflictError,
  OwnershipTransferTransactionUnavailableError,
  isTransactionUnavailableError,
  type OwnershipTransferApplyInput,
  type OwnershipTransferStore,
} from './ownership-transfer.store'

@Injectable()
export class MongoOwnershipTransferStore
  implements OwnershipTransferStore, OnModuleDestroy
{
  private readonly logger = new Logger(MongoOwnershipTransferStore.name)
  private client: MongoClient | null = null
  private clientPromise: Promise<MongoClient> | null = null

  public constructor(private readonly configService: ConfigService) {}

  public async apply(
    input: OwnershipTransferApplyInput
  ): Promise<OwnershipTransferFinalReport> {
    const client = await this.getClient()
    const session = client.startSession()
    try {
      const report = await session.withTransaction(async () => {
        const database = client.db()
        const transfers = database.collection('property_ownership_transfers')
        const transferRecords = database.collection(
          'property_ownership_transfer_records'
        )
        const transferId = toObjectId(input.transferId, 'transfer')
        const transfer = await transfers.findOne(
          { _id: transferId },
          { session }
        )

        if (!transfer) {
          throw new OwnershipTransferApplyConflictError(
            'Ownership transfer preview was not found'
          )
        }
        if (transfer.previewHash !== input.expectedPreviewHash) {
          throw new OwnershipTransferApplyConflictError(
            'Ownership transfer preview hash is stale'
          )
        }
        if (
          transfer.status === 'completed' &&
          transfer.idempotencyKey === input.idempotencyKey
        ) {
          return (
            (transfer.finalReport as
              | OwnershipTransferFinalReport
              | undefined) ?? emptyFinalReport()
          )
        }
        if (transfer.status !== 'previewed') {
          throw new OwnershipTransferApplyConflictError(
            'Ownership transfer is not available for apply'
          )
        }

        const appliedAt = new Date()
        let updatedApartments = 0
        let reassignedBookings = 0
        let reassignedApplications = 0

        for (const record of input.records) {
          const updateResult = await updateOperationalRecord(
            database,
            record,
            input.targetLandlordId,
            input.transferId,
            session
          )
          if (updateResult === 'apartment') updatedApartments += 1
          if (updateResult === 'booking') reassignedBookings += 1
          if (updateResult === 'rentalApplication') reassignedApplications += 1

          await transferRecords.updateOne(
            {
              transferId: input.transferId,
              entityType: record.entityType,
              entityId: record.entityId,
            },
            {
              $set: {
                afterVersion: appliedAt.toISOString(),
                toLandlordId: input.targetLandlordId,
              },
              $setOnInsert: {
                transferId: input.transferId,
                entityType: record.entityType,
                entityId: record.entityId,
                action: immutableEntity(record)
                  ? 'historical-linked'
                  : 'ownership-updated',
                fromLandlordId: record.fromLandlordId,
                beforeVersion: record.version,
                metadata: {
                  previewHash: input.expectedPreviewHash,
                  immutable: immutableEntity(record),
                },
              },
            },
            { upsert: true, session }
          )
        }

        const finalReport: OwnershipTransferFinalReport = {
          updatedApartments,
          reassignedBookings,
          reassignedApplications,
          preservedContracts: countEntities(input.records, 'contract'),
          preservedDepositAgreements: countEntities(
            input.records,
            'depositAgreement'
          ),
          preservedPayments: countEntities(input.records, 'payment'),
          preservedDisputes: countEntities(input.records, 'dispute'),
          auditRecordCount: input.records.length,
        }
        await transfers.updateOne(
          { _id: transferId, status: 'previewed' },
          {
            $set: {
              status: 'completed',
              idempotencyKey: input.idempotencyKey,
              finalReport,
              completedAt: appliedAt,
              updatedAt: appliedAt,
            },
          },
          { session }
        )
        return finalReport
      })

      this.logger.log(
        JSON.stringify({
          event: 'ownership_transfer_completed',
          transferId: input.transferId,
          targetLandlordId: input.targetLandlordId,
          idempotencyKey: input.idempotencyKey,
          report,
        })
      )
      return report
    } catch (error) {
      if (error instanceof OwnershipTransferApplyConflictError) throw error
      if (isTransactionUnavailableError(error)) {
        throw new OwnershipTransferTransactionUnavailableError(
          'MongoDB transactions are required for ownership transfer apply',
          { cause: error }
        )
      }
      throw error
    } finally {
      await session.endSession()
    }
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.close()
    this.client = null
    this.clientPromise = null
  }

  private async getClient(): Promise<MongoClient> {
    if (this.client) return this.client
    this.clientPromise ??= MongoClient.connect(
      this.configService.getOrThrow<string>('database.url')
    )
    this.client = await this.clientPromise
    return this.client
  }
}

type OperationalEntityType = 'apartment' | 'booking' | 'rentalApplication'

async function updateOperationalRecord(
  database: ReturnType<MongoClient['db']>,
  record: OwnershipTransferManifestRecord,
  targetLandlordId: string,
  transferId: string,
  session: ClientSession
): Promise<OperationalEntityType | null> {
  if (immutableEntity(record)) return null

  const collectionName =
    record.entityType === 'rentalApplication'
      ? 'rental_applications'
      : `${record.entityType}s`
  const collection = database.collection(collectionName)
  const objectId = toObjectId(record.entityId, record.entityType)
  const filter = { _id: objectId, landlordId: record.fromLandlordId }
  const update =
    record.entityType === 'apartment'
      ? {
          $set: {
            landlordId: targetLandlordId,
            ownershipTransferId: transferId,
          },
        }
      : [
          {
            $set: {
              landlordId: targetLandlordId,
              ownershipTransferId: transferId,
              originalLandlordId: {
                $ifNull: ['$originalLandlordId', record.fromLandlordId],
              },
            },
          },
        ]

  const result = await collection.updateOne(filter, update, { session })
  if (result.matchedCount !== 1) {
    throw new OwnershipTransferApplyConflictError(
      `Ownership transfer record changed: ${record.entityType}/${record.entityId}`
    )
  }
  if (
    record.entityType === 'apartment' ||
    record.entityType === 'booking' ||
    record.entityType === 'rentalApplication'
  ) {
    return record.entityType
  }
  return null
}

function toObjectId(value: string, label: string): ObjectId {
  if (!ObjectId.isValid(value)) {
    throw new OwnershipTransferApplyConflictError(
      `Invalid ${label} identifier in ownership transfer manifest`
    )
  }
  return new ObjectId(value)
}

function immutableEntity(record: OwnershipTransferManifestRecord): boolean {
  return (
    record.entityType === 'contract' ||
    record.entityType === 'depositAgreement' ||
    record.entityType === 'payment' ||
    record.entityType === 'dispute'
  )
}

function countEntities(
  records: readonly OwnershipTransferManifestRecord[],
  entityType: OwnershipTransferManifestRecord['entityType']
): number {
  return records.filter(record => record.entityType === entityType).length
}

function emptyFinalReport(): OwnershipTransferFinalReport {
  return {
    updatedApartments: 0,
    reassignedBookings: 0,
    reassignedApplications: 0,
    preservedContracts: 0,
    preservedDepositAgreements: 0,
    preservedPayments: 0,
    preservedDisputes: 0,
    auditRecordCount: 0,
  }
}
