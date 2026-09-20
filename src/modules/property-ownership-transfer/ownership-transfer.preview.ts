import type {
  OwnershipTransferConflict,
  OwnershipTransferCounts,
} from './schemas/property-ownership-transfer.schema'
import {
  createOwnershipTransferManifest,
  type OwnershipTransferManifest,
  type OwnershipTransferManifestEntityType,
  type OwnershipTransferManifestRecordInput,
} from './ownership-transfer.manifest'

export interface OwnershipTransferApartmentSnapshot {
  readonly id: string
  readonly landlordId: string
  readonly version: string
}

export interface OwnershipTransferBookingSnapshot {
  readonly id: string
  readonly apartmentId: string
  readonly landlordId: string
  readonly status:
    | 'pending'
    | 'confirmed'
    | 'rejected'
    | 'cancelled'
    | 'completed'
  readonly version: string
}

export interface OwnershipTransferApplicationSnapshot {
  readonly id: string
  readonly apartmentId: string
  readonly landlordId: string
  readonly status: 'pending' | 'accepted' | 'rejected'
  readonly version: string
}

export interface OwnershipTransferLinkedSnapshot {
  readonly id: string
  readonly landlordId: string
  readonly version: string
}

export interface OwnershipTransferContractSnapshot extends OwnershipTransferLinkedSnapshot {
  readonly propertyId: string
}

export interface OwnershipTransferDepositSnapshot extends OwnershipTransferLinkedSnapshot {
  readonly propertyId?: string | null
}

export interface OwnershipTransferPaymentSnapshot extends OwnershipTransferLinkedSnapshot {
  readonly contractId: string
}

export interface OwnershipTransferDisputeSnapshot extends OwnershipTransferLinkedSnapshot {
  readonly contractId: string
}

export interface OwnershipTransferPreviewInput {
  readonly targetLandlordId: string
  readonly knownUserIds: ReadonlySet<string>
  readonly apartments: readonly OwnershipTransferApartmentSnapshot[]
  readonly bookings: readonly OwnershipTransferBookingSnapshot[]
  readonly applications: readonly OwnershipTransferApplicationSnapshot[]
  readonly contracts: readonly OwnershipTransferContractSnapshot[]
  readonly depositAgreements: readonly OwnershipTransferDepositSnapshot[]
  readonly payments: readonly OwnershipTransferPaymentSnapshot[]
  readonly disputes: readonly OwnershipTransferDisputeSnapshot[]
}

export interface OwnershipTransferSourceOwnerSummary {
  readonly userId: string
  readonly apartmentCount: number
}

export interface OwnershipTransferPreviewResult {
  readonly sourceOwners: readonly OwnershipTransferSourceOwnerSummary[]
  readonly affectedCounts: OwnershipTransferCounts
  readonly immutableCounts: Omit<
    OwnershipTransferCounts,
    'apartments' | 'openBookings' | 'openApplications'
  >
  readonly conflicts: readonly OwnershipTransferConflict[]
  readonly manifest: OwnershipTransferManifest
  readonly previewHash: string
}

type RecordCandidate = OwnershipTransferManifestRecordInput

export function buildOwnershipTransferPreview(
  input: OwnershipTransferPreviewInput
): OwnershipTransferPreviewResult {
  const conflicts: OwnershipTransferConflict[] = []
  const apartmentById = new Map(
    input.apartments.map(apartment => [apartment.id, apartment])
  )
  const impactedApartmentIds = new Set<string>()
  const sourceOwnerCounts = new Map<string, number>()
  const records: RecordCandidate[] = []

  for (const apartment of input.apartments) {
    if (!apartment.landlordId) {
      conflicts.push({
        code: 'MISSING_SOURCE_OWNER',
        entityType: 'apartment',
        entityId: apartment.id,
        message: 'Apartment has no current landlord.',
      })
      continue
    }

    if (
      apartment.landlordId !== input.targetLandlordId &&
      !input.knownUserIds.has(apartment.landlordId)
    ) {
      conflicts.push({
        code: 'UNKNOWN_SOURCE_OWNER',
        entityType: 'apartment',
        entityId: apartment.id,
        message: 'Apartment landlord does not resolve to an existing user.',
      })
    }

    if (apartment.landlordId === input.targetLandlordId) continue

    impactedApartmentIds.add(apartment.id)
    sourceOwnerCounts.set(
      apartment.landlordId,
      (sourceOwnerCounts.get(apartment.landlordId) ?? 0) + 1
    )
    records.push({
      entityType: 'apartment',
      entityId: apartment.id,
      fromLandlordId: apartment.landlordId,
      version: apartment.version,
    })
  }

  for (const booking of input.bookings) {
    if (!isOpenBooking(booking.status)) continue
    const apartment = apartmentById.get(booking.apartmentId)
    if (!apartment) {
      conflicts.push({
        code: 'ORPHAN_OPEN_BOOKING',
        entityType: 'booking',
        entityId: booking.id,
        message: 'Open booking references a missing apartment.',
      })
      continue
    }
    if (!impactedApartmentIds.has(booking.apartmentId)) continue
    if (booking.landlordId === input.targetLandlordId) continue
    if (!input.knownUserIds.has(booking.landlordId)) {
      conflicts.push({
        code: 'UNKNOWN_BOOKING_OWNER',
        entityType: 'booking',
        entityId: booking.id,
        message: 'Open booking landlord does not resolve to an existing user.',
      })
    }
    records.push(
      toCandidate('booking', booking.id, booking.landlordId, booking.version)
    )
  }

  for (const application of input.applications) {
    if (application.status !== 'pending') continue
    const apartment = apartmentById.get(application.apartmentId)
    if (!apartment) {
      conflicts.push({
        code: 'ORPHAN_OPEN_APPLICATION',
        entityType: 'rentalApplication',
        entityId: application.id,
        message: 'Open rental application references a missing apartment.',
      })
      continue
    }
    if (!impactedApartmentIds.has(application.apartmentId)) continue
    if (application.landlordId === input.targetLandlordId) continue
    if (!input.knownUserIds.has(application.landlordId)) {
      conflicts.push({
        code: 'UNKNOWN_APPLICATION_OWNER',
        entityType: 'rentalApplication',
        entityId: application.id,
        message:
          'Open rental application landlord does not resolve to an existing user.',
      })
    }
    records.push(
      toCandidate(
        'rentalApplication',
        application.id,
        application.landlordId,
        application.version
      )
    )
  }

  const impactedContractIds = new Set<string>()
  for (const contract of input.contracts) {
    if (!impactedApartmentIds.has(contract.propertyId)) continue
    impactedContractIds.add(contract.id)
    records.push(
      toCandidate(
        'contract',
        contract.id,
        contract.landlordId,
        contract.version
      )
    )
  }

  for (const agreement of input.depositAgreements) {
    if (
      !agreement.propertyId ||
      !impactedApartmentIds.has(agreement.propertyId)
    )
      continue
    records.push(
      toCandidate(
        'depositAgreement',
        agreement.id,
        agreement.landlordId,
        agreement.version
      )
    )
  }

  for (const payment of input.payments) {
    if (!impactedContractIds.has(payment.contractId)) continue
    records.push(
      toCandidate('payment', payment.id, payment.landlordId, payment.version)
    )
  }

  for (const dispute of input.disputes) {
    if (!impactedContractIds.has(dispute.contractId)) continue
    records.push(
      toCandidate('dispute', dispute.id, dispute.landlordId, dispute.version)
    )
  }

  const { manifest, previewHash } = createOwnershipTransferManifest({
    targetLandlordId: input.targetLandlordId,
    records,
  })

  return {
    sourceOwners: [...sourceOwnerCounts.entries()]
      .map(([userId, apartmentCount]) => ({ userId, apartmentCount }))
      .sort((left, right) => left.userId.localeCompare(right.userId)),
    affectedCounts: {
      apartments: records.filter(record => record.entityType === 'apartment')
        .length,
      openBookings: records.filter(record => record.entityType === 'booking')
        .length,
      openApplications: records.filter(
        record => record.entityType === 'rentalApplication'
      ).length,
      contracts: records.filter(record => record.entityType === 'contract')
        .length,
      depositAgreements: records.filter(
        record => record.entityType === 'depositAgreement'
      ).length,
      payments: records.filter(record => record.entityType === 'payment')
        .length,
      disputes: records.filter(record => record.entityType === 'dispute')
        .length,
    },
    immutableCounts: {
      contracts: records.filter(record => record.entityType === 'contract')
        .length,
      depositAgreements: records.filter(
        record => record.entityType === 'depositAgreement'
      ).length,
      payments: records.filter(record => record.entityType === 'payment')
        .length,
      disputes: records.filter(record => record.entityType === 'dispute')
        .length,
    },
    conflicts,
    manifest,
    previewHash,
  }
}

function toCandidate(
  entityType: OwnershipTransferManifestEntityType,
  entityId: string,
  fromLandlordId: string,
  version: string
): RecordCandidate {
  return { entityType, entityId, fromLandlordId, version }
}

function isOpenBooking(
  status: OwnershipTransferBookingSnapshot['status']
): boolean {
  return status === 'pending' || status === 'confirmed'
}
