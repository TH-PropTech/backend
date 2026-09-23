import { buildProp321ReconciliationReport } from './prop-321-reconciliation'

describe('PROP-321 reconciliation report', () => {
  it('counts legacy, policy, unresolved, orphaned, and hash-backfill cohorts without mutating the snapshot', () => {
    const input = {
      apartments: [
        {
          rentalPackages: [{ durationMonths: 1 }],
          rentalReservation: {
            applicationId: 'missing-application',
            releasedAt: null,
          },
        },
        {
          rentalPackages: [{ durationMonths: 12 }],
          rentalReservation: {
            applicationId: 'application-1',
            releasedAt: null,
          },
        },
      ],
      applications: [
        {
          _id: 'application-1',
          status: 'accepted',
          contractId: null,
          provisioningStatus: 'failed',
        },
        {
          _id: 'application-2',
          status: 'pending',
          executionPolicySnapshot: { strategy: 'DEPOSIT_FIRST' as const },
        },
      ],
      contracts: [
        {
          _id: 'contract-legacy',
          status: 'draft',
          packageSnapshot: { durationMonths: 1 },
          artifactRef: null,
        },
        {
          _id: 'contract-hash',
          status: 'draft',
          packageSnapshot: { durationMonths: 12 },
          artifactRef: { revision: 1, artifactHash: 'hash-1' },
          executionPolicySnapshot: { strategy: 'DEPOSIT_FIRST' as const },
        },
        {
          _id: 'contract-active',
          status: 'active',
          packageSnapshot: { durationMonths: 12 },
          artifactRef: { revision: 2, artifactHash: 'hash-2' },
          executionPolicySnapshot: { strategy: 'SIGN_FIRST' as const },
          ledgerEvidence: { schemaVersion: 2 },
        },
      ],
    }
    const before = structuredClone(input)

    expect(buildProp321ReconciliationReport(input)).toEqual({
      scannedApartments: 2,
      scannedApplications: 2,
      scannedContracts: 3,
      legacyOneMonthPackages: 1,
      legacyOneMonthContracts: 1,
      applicationPolicyBackfillEligible: 1,
      contractPolicyBackfillEligible: 1,
      unresolvedAcceptedApplications: 1,
      orphanedReservations: 1,
      hashVersionBackfillEligible: 1,
      ambiguousRecords: 0,
    })
    expect(input).toEqual(before)
  })

  it('keeps signed/active contracts out of policy backfill and flags ambiguous live reservations', () => {
    const report = buildProp321ReconciliationReport({
      apartments: [
        {
          rentalReservation: {
            applicationId: null,
            contractId: 'contract-1',
            releasedAt: null,
          },
        },
      ],
      applications: [],
      contracts: [
        {
          status: 'active',
          artifactRef: { revision: 1, artifactHash: 'hash-1' },
        },
      ],
    })

    expect(report.contractPolicyBackfillEligible).toBe(0)
    expect(report.orphanedReservations).toBe(1)
    expect(report.ambiguousRecords).toBe(1)
  })
})
