import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import type { DeepPartial, ObjectLiteral, Repository } from 'typeorm'
import { User, UserStatus } from '../../users/schemas/user.schema'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { Booking } from '../../bookings/schemas/booking.schema'
import { RentalApplication } from '../../rental/schemas/rental-application.schema'
import { Contract } from '../../contracts/schemas/contract.schema'
import { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import { Payment } from '../../payments/schemas/payment.schema'
import { Dispute } from '../../community/schemas/dispute.schema'
import {
  OwnershipTransferCounts,
  PropertyOwnershipTransfer,
  OwnershipTransferConflict,
} from '../schemas/property-ownership-transfer.schema'
import { PropertyOwnershipTransferRecord } from '../schemas/property-ownership-transfer-record.schema'
import {
  ApplyOwnershipTransferDto,
  isValidOwnershipTransferIdempotencyKey,
  OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH,
  OwnershipTransferTargetResponse,
} from '../dto/ownership-transfer.dto'
import {
  buildOwnershipTransferPreview,
  type OwnershipTransferPreviewResult,
} from '../utils/ownership-transfer.preview'
import {
  normalizeOwnershipTransferEmail,
  type OwnershipTransferManifestRecord,
} from '../utils/ownership-transfer.manifest'
import {
  OWNERSHIP_TRANSFER_STORE,
  OwnershipTransferApplyConflictError,
  OwnershipTransferTransactionUnavailableError,
  type OwnershipTransferStore,
} from './ownership-transfer.store'

export type OwnershipTransferRepository<T extends ObjectLiteral> = Pick<
  Repository<T>,
  'find' | 'findOne' | 'create' | 'save'
>

export interface OwnershipTransferPreviewResponse {
  transferId: string
  targetUser: OwnershipTransferTargetResponse
  sourceOwners: ReadonlyArray<{ userId: string; apartmentCount: number }>
  affectedCounts: OwnershipTransferCounts
  immutableCounts: Omit<
    OwnershipTransferCounts,
    'apartments' | 'openBookings' | 'openApplications'
  >
  conflicts: readonly OwnershipTransferConflict[]
  previewHash: string
  expiresAt: string
}

export interface OwnershipTransferSummaryResponse extends Omit<
  OwnershipTransferPreviewResponse,
  'targetUser'
> {
  status: PropertyOwnershipTransfer['status']
  targetUser: OwnershipTransferTargetResponse | null
  idempotencyKey: string | null
  completedAt: string | null
  auditRecordCount: number
}

@Injectable()
export class OwnershipTransferService {
  private readonly logger = new Logger(OwnershipTransferService.name)

  public constructor(
    @InjectRepository(User)
    private readonly userRepository: OwnershipTransferRepository<User>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: OwnershipTransferRepository<Apartment>,
    @InjectRepository(Booking)
    private readonly bookingRepository: OwnershipTransferRepository<Booking>,
    @InjectRepository(RentalApplication)
    private readonly applicationRepository: OwnershipTransferRepository<RentalApplication>,
    @InjectRepository(Contract)
    private readonly contractRepository: OwnershipTransferRepository<Contract>,
    @InjectRepository(DepositAgreement)
    private readonly depositRepository: OwnershipTransferRepository<DepositAgreement>,
    @InjectRepository(Payment)
    private readonly paymentRepository: OwnershipTransferRepository<Payment>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: OwnershipTransferRepository<Dispute>,
    @InjectRepository(PropertyOwnershipTransfer)
    private readonly transferRepository: OwnershipTransferRepository<PropertyOwnershipTransfer>,
    @InjectRepository(PropertyOwnershipTransferRecord)
    private readonly recordRepository: OwnershipTransferRepository<PropertyOwnershipTransferRecord>,
    @Inject(OWNERSHIP_TRANSFER_STORE)
    private readonly transferStore: OwnershipTransferStore
  ) {}

  public async preview(
    targetEmail: string,
    initiatedBy: string
  ): Promise<OwnershipTransferPreviewResponse> {
    const normalizedEmail = normalizeOwnershipTransferEmail(targetEmail)
    const target = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    })

    if (!target) {
      throw new NotFoundException('Target landlord account was not found')
    }
    this.assertEligibleTarget(target)

    const targetLandlordId = entityId(target)
    const preview = await this.scanPreview(targetLandlordId)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const transfer = this.transferRepository.create({
      targetLandlordId,
      initiatedBy,
      status: 'previewed',
      previewHash: preview.previewHash,
      idempotencyKey: null,
      sourceOwnerIds: preview.manifest.sourceOwnerIds as string[],
      affectedCounts: preview.affectedCounts,
      immutableCounts: preview.immutableCounts,
      conflicts: [...preview.conflicts],
      finalReport: null,
      expiresAt,
      completedAt: null,
    })
    const savedTransfer = await saveOne(this.transferRepository, transfer)
    const transferId = entityId(savedTransfer)

    await Promise.all(
      preview.manifest.records.map(record =>
        this.recordRepository.save(
          this.recordRepository.create(
            toAuditRecord(transferId, preview.previewHash, record)
          )
        )
      )
    )

    this.logger.log(
      JSON.stringify({
        event: 'ownership_transfer_previewed',
        transferId,
        initiatedBy,
        targetLandlordId,
        conflictCount: preview.conflicts.length,
        affectedCounts: preview.affectedCounts,
      })
    )

    return {
      transferId,
      targetUser: toTargetUserResponse(target),
      sourceOwners: preview.sourceOwners,
      affectedCounts: preview.affectedCounts,
      immutableCounts: preview.immutableCounts,
      conflicts: preview.conflicts,
      previewHash: preview.previewHash,
      expiresAt: expiresAt.toISOString(),
    }
  }

  public async getSummary(
    transferId: string
  ): Promise<OwnershipTransferSummaryResponse> {
    const transfer = await this.findTransfer(transferId)
    const records = await this.recordRepository.find({
      where: { transferId },
    })
    const target = ObjectId.isValid(transfer.targetLandlordId)
      ? await this.userRepository.findOne({
          where: { _id: new ObjectId(transfer.targetLandlordId) },
        })
      : null

    return {
      transferId,
      targetUser: target ? toTargetUserResponse(target) : null,
      sourceOwners: transfer.sourceOwnerIds.map(userId => ({
        userId,
        apartmentCount: 0,
      })),
      affectedCounts: transfer.affectedCounts,
      immutableCounts: transfer.immutableCounts,
      conflicts: transfer.conflicts,
      previewHash: transfer.previewHash,
      expiresAt: transfer.expiresAt.toISOString(),
      status: transfer.status,
      idempotencyKey: transfer.idempotencyKey ?? null,
      completedAt: transfer.completedAt?.toISOString() ?? null,
      auditRecordCount: records.length,
    }
  }

  public async apply(
    transferId: string,
    dto: ApplyOwnershipTransferDto,
    idempotencyKey: string | undefined
  ): Promise<OwnershipTransferSummaryResponse> {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.trim().length === 0
    ) {
      throw new BadRequestException('Idempotency-Key header is required')
    }
    if (idempotencyKey.length > OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new BadRequestException('Idempotency-Key header is too long')
    }
    if (!isValidOwnershipTransferIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException('Idempotency-Key header is invalid')
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(dto.previewHash)) {
      throw new BadRequestException('previewHash must be a valid SHA-256 hash')
    }

    const transfer = await this.findTransfer(transferId)
    if (transfer.previewHash !== dto.previewHash) {
      throw new ConflictException('Ownership transfer preview hash is stale')
    }

    const existingByIdempotencyKey = await this.transferRepository.findOne({
      where: { idempotencyKey },
    })
    if (
      existingByIdempotencyKey &&
      entityId(existingByIdempotencyKey) !== transferId
    ) {
      throw new ConflictException(
        'Idempotency-Key is already used by another transfer'
      )
    }

    if (transfer.status === 'completed') {
      if (transfer.idempotencyKey === idempotencyKey) {
        return this.getSummary(transferId)
      }
      throw new ConflictException('Ownership transfer was already completed')
    }
    if (transfer.status !== 'previewed') {
      throw new ConflictException(
        'Ownership transfer is not available for apply'
      )
    }
    if (transfer.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Ownership transfer preview has expired')
    }
    if (transfer.conflicts.length > 0) {
      throw new ConflictException(
        'Ownership transfer has unresolved integrity conflicts'
      )
    }

    if (!ObjectId.isValid(transfer.targetLandlordId)) {
      throw new ConflictException('Ownership transfer target is invalid')
    }
    const target = await this.userRepository.findOne({
      where: { _id: new ObjectId(transfer.targetLandlordId) },
    })
    if (!target)
      throw new NotFoundException('Target landlord account was not found')
    this.assertEligibleTarget(target)

    const latestPreview = await this.scanPreview(transfer.targetLandlordId)
    if (latestPreview.previewHash !== transfer.previewHash) {
      throw new ConflictException('Ownership transfer preview is stale')
    }

    try {
      await this.transferStore.apply({
        transferId,
        targetLandlordId: transfer.targetLandlordId,
        idempotencyKey,
        records: latestPreview.manifest.records,
        expectedPreviewHash: transfer.previewHash,
      })
    } catch (error) {
      if (error instanceof OwnershipTransferTransactionUnavailableError) {
        throw new UnprocessableEntityException(error.message)
      }
      if (error instanceof OwnershipTransferApplyConflictError) {
        throw new ConflictException(error.message)
      }
      throw error
    }

    return this.getSummary(transferId)
  }

  private async scanPreview(
    targetLandlordId: string
  ): Promise<OwnershipTransferPreviewResult> {
    const [
      users,
      apartments,
      bookings,
      applications,
      contracts,
      deposits,
      payments,
      disputes,
    ] = await Promise.all([
      this.userRepository.find(),
      this.apartmentRepository.find(),
      this.bookingRepository.find(),
      this.applicationRepository.find(),
      this.contractRepository.find(),
      this.depositRepository.find(),
      this.paymentRepository.find(),
      this.disputeRepository.find(),
    ])

    return buildOwnershipTransferPreview({
      targetLandlordId,
      knownUserIds: new Set(users.map(user => entityId(user))),
      apartments: apartments.map(apartment => ({
        id: entityId(apartment),
        landlordId: apartment.landlordId,
        version: versionOf(apartment.updatedAt, apartment.createdAt),
      })),
      bookings: bookings.map(booking => ({
        id: entityId(booking),
        apartmentId: booking.apartmentId,
        landlordId: booking.landlordId,
        status: booking.status,
        version: versionOf(booking.updatedAt, booking.createdAt),
      })),
      applications: applications.map(application => ({
        id: entityId(application),
        apartmentId: application.apartmentId,
        landlordId: application.landlordId,
        status: application.status,
        version: versionOf(application.updatedAt, application.createdAt),
      })),
      contracts: contracts.map(contract => ({
        id: entityId(contract),
        propertyId: contract.propertyId,
        landlordId: contract.landlordId,
        version: versionOf(contract.updatedAt, contract.createdAt),
      })),
      depositAgreements: deposits.map(agreement => ({
        id: entityId(agreement),
        propertyId: agreement.propertyId ?? null,
        landlordId: agreement.landlordId,
        version: versionOf(agreement.updatedAt, agreement.createdAt),
      })),
      payments: payments.map(payment => ({
        id: entityId(payment),
        contractId: payment.contractId,
        landlordId: payment.landlordId,
        version: versionOf(payment.updatedAt, payment.createdAt),
      })),
      disputes: disputes.map(dispute => ({
        id: entityId(dispute),
        contractId: dispute.contractId,
        landlordId: dispute.landlordId,
        version: versionOf(dispute.updatedAt, dispute.createdAt),
      })),
    })
  }

  private async findTransfer(
    transferId: string
  ): Promise<PropertyOwnershipTransfer> {
    if (!ObjectId.isValid(transferId)) {
      throw new NotFoundException('Ownership transfer was not found')
    }
    const transfer = await this.transferRepository.findOne({
      where: { _id: new ObjectId(transferId) },
    })
    if (!transfer) {
      throw new NotFoundException('Ownership transfer was not found')
    }
    return transfer
  }

  private assertEligibleTarget(target: User): void {
    if (target.status !== UserStatus.ACTIVE || target.role !== 'landlord') {
      throw new ConflictException('Target account must be an active landlord')
    }
  }
}

function entityId(entity: { _id: ObjectId }): string {
  return entity._id.toString()
}

function versionOf(updatedAt: Date, createdAt: Date): string {
  return (updatedAt ?? createdAt).toISOString()
}

async function saveOne<T extends ObjectLiteral>(
  repository: OwnershipTransferRepository<T>,
  value: T
): Promise<T> {
  const saved: T | T[] = await repository.save(value)
  if (!Array.isArray(saved)) return saved
  const savedArray: T[] = saved
  return savedArray[0] ?? value
}

function toTargetUserResponse(user: User): OwnershipTransferTargetResponse {
  return {
    id: entityId(user),
    email: user.email,
    role: 'landlord',
  }
}

function toAuditRecord(
  transferId: string,
  previewHash: string,
  record: OwnershipTransferManifestRecord
): DeepPartial<PropertyOwnershipTransferRecord> {
  const isImmutable =
    record.entityType === 'contract' ||
    record.entityType === 'depositAgreement' ||
    record.entityType === 'payment' ||
    record.entityType === 'dispute'
  return {
    transferId,
    entityType: record.entityType,
    entityId: record.entityId,
    action: isImmutable ? 'historical-linked' : 'ownership-updated',
    fromLandlordId: record.fromLandlordId,
    toLandlordId: record.toLandlordId,
    beforeVersion: record.version,
    afterVersion: null,
    metadata: { previewHash, immutable: isImmutable },
  }
}
