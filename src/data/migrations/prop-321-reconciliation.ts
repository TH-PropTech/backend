export type ReconciliationExecutionPolicy = {
  strategy?: 'DEPOSIT_FIRST' | 'SIGN_FIRST'
}

export type ReconciliationPackage = {
  durationMonths?: number | null
  defaultExecutionPolicy?: ReconciliationExecutionPolicy | null
}

export type ReconciliationApartment = {
  rentalPackages?: ReconciliationPackage[] | null
  rentalReservation?: {
    applicationId?: string | null
    releasedAt?: Date | string | null
    contractId?: string | null
  } | null
}

export type ReconciliationApplication = {
  _id?: string
  status?: string
  contractId?: string | null
  provisioningStatus?: string | null
  executionPolicySnapshot?: ReconciliationExecutionPolicy | null
  packageSnapshot?: ReconciliationPackage | null
}

export type ReconciliationContract = {
  _id?: string
  status?: string
  executionPolicySnapshot?: ReconciliationExecutionPolicy | null
  packageSnapshot?: ReconciliationPackage | null
  artifactRef?: {
    revision?: number | null
    artifactHash?: string | null
  } | null
  ledgerEvidence?: { schemaVersion?: number | null } | null
}

export type Prop321ReconciliationInput = {
  apartments: ReconciliationApartment[]
  applications: ReconciliationApplication[]
  contracts: ReconciliationContract[]
}

export type Prop321ReconciliationReport = {
  scannedApartments: number
  scannedApplications: number
  scannedContracts: number
  legacyOneMonthPackages: number
  legacyOneMonthContracts: number
  applicationPolicyBackfillEligible: number
  contractPolicyBackfillEligible: number
  unresolvedAcceptedApplications: number
  orphanedReservations: number
  hashVersionBackfillEligible: number
  ambiguousRecords: number
}

const IMMUTABLE_CONTRACT_STATUSES = new Set([
  'active',
  'completed',
  'terminated',
])

function hasActiveReservation(
  reservation: ReconciliationApartment['rentalReservation']
): reservation is NonNullable<ReconciliationApartment['rentalReservation']> {
  return Boolean(reservation && !reservation.releasedAt)
}

function canBackfillApplicationPolicy(
  application: ReconciliationApplication
): boolean {
  return (
    !application.executionPolicySnapshot &&
    (application.status === 'pending' || application.status === 'accepted')
  )
}

function canBackfillContractPolicy(contract: ReconciliationContract): boolean {
  return (
    !contract.executionPolicySnapshot &&
    !IMMUTABLE_CONTRACT_STATUSES.has(contract.status ?? '') &&
    !contract.artifactRef
  )
}

/**
 * Produces a read-only reconciliation report for a sanitized data snapshot.
 * It deliberately does not infer values or mutate records; an operator must
 * review the counts before applying the separately approved backfill.
 */
export function buildProp321ReconciliationReport(
  input: Prop321ReconciliationInput
): Prop321ReconciliationReport {
  const applicationIds = new Set(
    input.applications
      .map(application => application._id)
      .filter((id): id is string => Boolean(id))
  )

  const legacyOneMonthPackages = input.apartments.reduce(
    (count, apartment) =>
      count +
      (apartment.rentalPackages ?? []).filter(
        rentalPackage => rentalPackage.durationMonths === 1
      ).length,
    0
  )

  const unresolvedAcceptedApplications = input.applications.filter(
    application =>
      application.status === 'accepted' &&
      (application.contractId == null ||
        application.provisioningStatus !== 'ready')
  ).length

  const orphanedReservations = input.apartments.filter(apartment => {
    const reservation = apartment.rentalReservation
    return (
      hasActiveReservation(reservation) &&
      (!reservation.applicationId ||
        !applicationIds.has(reservation.applicationId))
    )
  }).length

  const ambiguousRecords = input.apartments.filter(apartment => {
    const reservation = apartment.rentalReservation
    return (
      hasActiveReservation(reservation) &&
      Boolean(reservation.contractId) &&
      !reservation.applicationId
    )
  }).length

  return {
    scannedApartments: input.apartments.length,
    scannedApplications: input.applications.length,
    scannedContracts: input.contracts.length,
    legacyOneMonthPackages,
    legacyOneMonthContracts: input.contracts.filter(
      contract => contract.packageSnapshot?.durationMonths === 1
    ).length,
    applicationPolicyBackfillEligible: input.applications.filter(
      canBackfillApplicationPolicy
    ).length,
    contractPolicyBackfillEligible: input.contracts.filter(
      canBackfillContractPolicy
    ).length,
    unresolvedAcceptedApplications,
    orphanedReservations,
    hashVersionBackfillEligible: input.contracts.filter(
      contract =>
        Boolean(contract.artifactRef?.artifactHash) &&
        contract.ledgerEvidence?.schemaVersion == null
    ).length,
    ambiguousRecords,
  }
}
