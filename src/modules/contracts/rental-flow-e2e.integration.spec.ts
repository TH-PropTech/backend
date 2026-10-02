import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import type { Contract } from './schemas/contract.schema'
import type { DepositAgreement } from './schemas/deposit-agreement.schema'
import { ContractsService } from './contracts.service'
import { DepositAgreementsService } from './deposit-agreements.service'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractViewService } from './contract-view.service'
import type { ContractArtifact } from './schemas/contract-artifact.schema'
import type { Payment } from '../payments/schemas/payment.schema'
import { PaymentsService } from '../payments/payments.service'
import type { MoveInSettlement } from '../move-in-settlements/schemas/move-in-settlement.schema'
import { MoveInSettlementsService } from '../move-in-settlements/move-in-settlements.service'
import { RentalTransactionsService } from '../rental-transactions/rental-transactions.service'
import type { RentalPackageSnapshot } from '../apartments/rental-package.util'

/**
 * Task 16.1 + 16.2 (openspec/changes/prop-321-rental-flow-e2e-upgrade).
 *
 * Follows the convention established by `canonical-workspace.integration.spec.ts`
 * and `smartca-activation.integration.spec.ts`: construct the real service
 * classes directly, back their TypeORM repositories with small in-memory
 * stores, and let the real business logic run unmocked. Only the ledger
 * outbox client and a few read-only collaborators (KYC lookup, ledger audit
 * query, artifact storage) are plain jest mocks.
 *
 * Unlike the existing fixtures (which share one mutable object across every
 * `findOne()` call), this file's in-memory repos clone entities on
 * `findOne`/`find`/`save`. This matters specifically for the 16.2 scenario:
 * `ContractsService.activateSmartCaContract` mutates its in-memory `contract`
 * argument (status, activationKey, ...) *before* awaiting
 * `ledgerOutboxService.enqueue()`. With reference semantics a simulated
 * enqueue failure would leak the half-applied mutation into the "persisted"
 * state even though `contractRepository.save()` was never reached -
 * misrepresenting real MongoDB/TypeORM behaviour (which only persists what a
 * completed `save()` call wrote). Cloning on read/write keeps the fixture
 * honest about what a failed activation attempt actually leaves behind.
 */

// ── Generic in-memory repository (shared by every entity in this file) ──

type WithId = { _id: ObjectId }

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (value instanceof ObjectId) return new ObjectId(value) as unknown as T
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T
  if (Array.isArray(value)) {
    const cloned: unknown[] = (value as unknown[]).map(item => cloneValue(item))
    return cloned as unknown as T
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneValue(val)
    }
    return result as unknown as T
  }
  return value
}

function matchesWhere(item: Record<string, unknown>, where: unknown): boolean {
  if (!where) return true
  if (Array.isArray(where)) return where.some(w => matchesWhere(item, w))
  return Object.entries(where as Record<string, unknown>).every(
    ([key, value]) => {
      if (value instanceof ObjectId) {
        const current = item[key]
        if (current instanceof ObjectId) return current.equals(value)
        return String(current) === value.toHexString()
      }
      // TypeORM `FindOperator`s (only `IsNull()` is used anywhere this
      // fixture drives) - treat any other object-valued condition as
      // "field must currently be null/undefined".
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return item[key] === null || item[key] === undefined
      }
      return item[key] === value
    }
  )
}

interface InMemoryRepo<T extends WithId> {
  findOne: jest.Mock<Promise<T | null>, [{ where: unknown }]>
  find: jest.Mock<Promise<T[]>, [({ where?: unknown } | undefined)?]>
  create: jest.Mock<T, [Partial<T>]>
  save: jest.Mock<Promise<T>, [T]>
  update: jest.Mock<Promise<{ affected: number }>, [unknown, Partial<T>]>
}

function createInMemoryRepo<T extends WithId>(): InMemoryRepo<T> {
  const store = new Map<string, T>()
  return {
    findOne: jest.fn(async ({ where }: { where: unknown }) => {
      await Promise.resolve()
      for (const item of store.values()) {
        if (matchesWhere(item, where)) {
          return cloneValue(item)
        }
      }
      return null
    }),
    find: jest.fn(async (options?: { where?: unknown }): Promise<T[]> => {
      await Promise.resolve()
      return Array.from(store.values())
        .filter(item =>
          matchesWhere(
            item as unknown as Record<string, unknown>,
            options?.where
          )
        )
        .map(item => cloneValue(item))
    }),
    create: jest.fn(
      (input: Partial<T>): T =>
        ({ _id: new ObjectId(), ...input }) as unknown as T
    ),
    save: jest.fn(async (value: T): Promise<T> => {
      await Promise.resolve()
      // `new Contract()` (and similar) never assigns `_id` itself - that is
      // normally the TypeORM/MongoDB driver's job on insert. Mirror that
      // here instead of requiring every caller to pre-assign one.
      const withId: T = value._id ? value : { ...value, _id: new ObjectId() }
      const stored = cloneValue(withId)
      store.set(stored._id.toHexString(), stored)
      return cloneValue(stored)
    }),
    update: jest.fn(
      async (
        where: unknown,
        partial: Partial<T>
      ): Promise<{ affected: number }> => {
        await Promise.resolve()
        let affected = 0
        for (const item of store.values()) {
          if (matchesWhere(item, where)) {
            Object.assign(item as object, cloneValue(partial))
            affected += 1
          }
        }
        return { affected }
      }
    ),
  }
}

// ── Fixture wiring ──

type LedgerEnqueueInput = {
  eventType: string
  aggregateType?: string
  aggregateId?: string
  dependencyKey?: string | null
}

function buildLedgerOutboxService(): {
  enqueue: jest.Mock<Promise<Record<string, unknown>>, [LedgerEnqueueInput]>
  failOnce: (eventType: string, message: string) => void
} {
  const failures = new Map<string, string>()
  const enqueue = jest.fn(async (input: LedgerEnqueueInput) => {
    await Promise.resolve()
    const failure = failures.get(input.eventType)
    if (failure) {
      failures.delete(input.eventType)
      throw new Error(failure)
    }
    return {}
  })
  return {
    enqueue,
    failOnce: (eventType, message) => failures.set(eventType, message),
  }
}

type Context = {
  contractRepo: ReturnType<typeof createInMemoryRepo<Contract>>
  depositRepo: ReturnType<typeof createInMemoryRepo<DepositAgreement>>
  paymentRepo: ReturnType<typeof createInMemoryRepo<Payment>>
  settlementRepo: ReturnType<typeof createInMemoryRepo<MoveInSettlement>>
  artifactRepo: ReturnType<typeof createInMemoryRepo<ContractArtifact>>
  ledgerOutboxService: ReturnType<typeof buildLedgerOutboxService>
  contractsService: ContractsService
  depositAgreementsService: DepositAgreementsService
  artifactService: ContractArtifactService
  paymentsService: PaymentsService
  moveInSettlementsService: MoveInSettlementsService
  contractViewService: ContractViewService
}

function buildContext(): Context {
  const contractRepo = createInMemoryRepo<Contract>()
  const depositRepo = createInMemoryRepo<DepositAgreement>()
  const paymentRepo = createInMemoryRepo<Payment>()
  const settlementRepo = createInMemoryRepo<MoveInSettlement>()
  const artifactRepo = createInMemoryRepo<ContractArtifact>()
  const ledgerOutboxService = buildLedgerOutboxService()

  const kycService = {
    findByUserId: jest
      .fn()
      .mockResolvedValue({ status: 'verified', idCardNumber: '000000000001' }),
  }
  const fabricService = {
    getChaincodeAbiVersion: jest.fn().mockReturnValue(2),
    getStatus: jest
      .fn()
      .mockReturnValue({ mode: 'simulation', connectionState: 'connected' }),
  }
  const ledgerAuditQueryService = {
    getContractEvents: jest.fn().mockResolvedValue([]),
  }
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  const storage = {
    upload: jest.fn().mockResolvedValue(new ObjectId()),
    download: jest.fn(),
  }

  const artifactService = new ContractArtifactService(
    contractRepo as never,
    artifactRepo as never,
    storage
  )
  // Artifact bytes are uploaded then re-downloaded by `resolveCanonicalArtifact`
  // (used by ContractViewService for the integrity/document layers). Echo
  // back whatever was most recently uploaded.
  let lastUploadedBytes: Buffer | null = null
  storage.upload.mockImplementation(async (bytes: Buffer) => {
    await Promise.resolve()
    lastUploadedBytes = bytes
    return new ObjectId()
  })
  storage.download.mockImplementation(async () => {
    await Promise.resolve()
    return lastUploadedBytes as Buffer
  })

  const paymentsService = new PaymentsService(
    paymentRepo as never,
    contractRepo as never,
    notificationsService as never,
    ledgerOutboxService as never
  )
  const moveInSettlementsService = new MoveInSettlementsService(
    settlementRepo as never,
    contractRepo as never,
    paymentRepo as never,
    notificationsService as never
  )
  const contractsService = new ContractsService(
    contractRepo as never,
    {} as never, // signingGrantRepository (not exercised by this flow)
    depositRepo as never,
    { findOne: jest.fn(), save: jest.fn() } as never, // apartmentRepository
    {} as never, // policiesService
    fabricService as never,
    ledgerOutboxService as never,
    kycService as never,
    {} as never, // ekycProxyService
    {} as never, // kycMediaService
    paymentsService,
    undefined, // biometricEvidenceService
    undefined, // smartOtpService
    undefined, // templateGovernanceService
    undefined, // amendmentRepository
    undefined, // flowNotificationService
    moveInSettlementsService,
    undefined, // layoutService
    undefined, // artifactService
    undefined // transactionEventService
  )
  const depositAgreementsService = new DepositAgreementsService(
    depositRepo as never,
    ledgerOutboxService as never,
    undefined, // apartmentRepository - keep undefined; propertyId in this
    // fixture is not a valid ObjectId (mirrors `canonical-workspace`'s
    // 'apartment-1'), and `projectApartmentDepositPaid` does not guard with
    // `ObjectId.isValid` before constructing one.
    contractsService,
    undefined, // ownershipTransferResolver
    contractRepo as never,
    undefined, // flowNotificationService
    undefined // transactionEventService
  )
  const contractViewService = new ContractViewService(
    contractRepo as never,
    depositRepo as never,
    kycService as never,
    ledgerAuditQueryService as never,
    fabricService as never,
    undefined, // ownershipTransferResolver
    artifactService,
    undefined, // templateGovernanceService
    undefined, // amendmentRepository
    settlementRepo as never
  )

  return {
    contractRepo,
    depositRepo,
    paymentRepo,
    settlementRepo,
    artifactRepo,
    ledgerOutboxService,
    contractsService,
    depositAgreementsService,
    artifactService,
    paymentsService,
    moveInSettlementsService,
    contractViewService,
  }
}

// ── Package / fixture builders ──

/** D5 worked example: 12-month package, 10,000,000 VND/month, 2-month
 * security deposit, 30% holding deposit, 3-month payment cycle. */
function buildHoldingPackageSnapshot(): RentalPackageSnapshot {
  return {
    packageId: 'pkg-e2e-holding-12',
    version: 1,
    durationMonths: 12,
    monthlyRent: 10_000_000,
    depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
    resolvedDepositAmount: 20_000_000,
    settlementPolicy: {
      holdingDeposit: { type: 'PERCENT_OF_SECURITY', percent: 30 },
      allowedPaymentCycles: [3],
      defaultPaymentCycle: 3,
      firstPaymentDueOffsetDays: 3,
    },
    resolvedHoldingDepositAmount: 6_000_000,
    resolvedSecurityTopUpAmount: 14_000_000,
    currency: 'VND',
  }
}

/** Simpler full-security package for the 16.2 SIGN_FIRST scenario, where the
 * holding-deposit/settlement machinery is not the behaviour under test. */
function buildFullSecurityPackageSnapshot(): RentalPackageSnapshot {
  return {
    packageId: 'pkg-e2e-full-security-6',
    version: 1,
    durationMonths: 6,
    monthlyRent: 8_000_000,
    depositPolicy: { type: 'MONTHS_OF_RENT', months: 2 },
    resolvedDepositAmount: 16_000_000,
    currency: 'VND',
  }
}

async function provisionContract(
  context: Context,
  strategy: 'DEPOSIT_FIRST' | 'SIGN_FIRST',
  packageSnapshot: RentalPackageSnapshot,
  options: {
    applicationId: string
    feeSnapshot?: Contract['feeSnapshot']
    paymentCycleMonths?: 1 | 3 | 6
  }
): Promise<{ contractId: string; agreementId: string }> {
  const tenantId = 'tenant-e2e-1'
  const landlordId = 'landlord-e2e-1'
  const executionPolicySnapshot = {
    policyId: strategy === 'DEPOSIT_FIRST' ? 'deposit-first' : 'sign-first',
    version: 1,
    strategy,
    contentHash: `policy-hash-${strategy.toLowerCase()}`,
  }

  const agreement =
    await context.depositAgreementsService.createFromApplicationSnapshot({
      applicationId: options.applicationId,
      propertyId: 'apartment-e2e-1', // not a valid ObjectId - see buildContext note
      tenantId,
      landlordId,
      packageSnapshot,
      executionPolicySnapshot,
    })

  const moveInDate = new Date('2026-11-01T00:00:00.000Z')
  const contract = await context.contractsService.createDraftFromApplication({
    rentalApplicationId: options.applicationId,
    depositAgreementId: agreement._id.toHexString(),
    propertyId: 'apartment-e2e-1',
    propertyTitle: 'Rental Flow E2E Apartment',
    propertyAddress: '1 E2E Street',
    propertyArea: 55,
    propertyFurniture: 'Fully furnished',
    landlordId,
    tenantId,
    moveInDate,
    packageSnapshot,
    paymentCycleMonths: options.paymentCycleMonths ?? 1,
    feeSnapshot: options.feeSnapshot ?? null,
    executionPolicySnapshot,
  })
  // Both parties sign via SmartCA in this spec.
  await context.contractRepo.update(
    { _id: contract._id },
    { executionMethod: 'SMARTCA' }
  )

  return {
    contractId: contract._id.toHexString(),
    agreementId: agreement._id.toHexString(),
  }
}

async function lockContentAndArtifact(
  context: Context,
  contractId: string,
  landlordId: string,
  pdfBytes: Buffer
): Promise<string> {
  await context.contractsService.lockContractContent(
    contractId,
    'staff-e2e-1',
    0,
    true
  )
  await context.artifactService.lockCanonicalArtifact(
    contractId,
    landlordId,
    false,
    pdfBytes
  )
  return createHash('sha256').update(pdfBytes).digest('hex')
}

async function signBothParties(
  context: Context,
  contractId: string,
  tenantId: string,
  landlordId: string,
  artifactHash: string,
  signedAt = new Date('2026-10-15T09:00:00.000Z')
): Promise<Contract> {
  await context.contractsService.recordSmartCaSignature({
    contractId,
    signerId: tenantId,
    role: 'tenant',
    artifactHash,
    providerTransactionId: 'sca-tx-tenant-1',
    certificateSerial: 'cert-tenant-1',
    signedAt,
  })
  return context.contractsService.recordSmartCaSignature({
    contractId,
    signerId: landlordId,
    role: 'landlord',
    artifactHash,
    providerTransactionId: 'sca-tx-landlord-1',
    certificateSerial: 'cert-landlord-1',
    signedAt,
  })
}

// ── 16.1: DEPOSIT_FIRST + holding deposit + SmartCA + settlement + handover ──

describe('rental flow E2E integration — DEPOSIT_FIRST with holding deposit', () => {
  const tenantId = 'tenant-e2e-1'
  const landlordId = 'landlord-e2e-1'
  const pdfBytes = Buffer.from('%PDF-1.7\nrental-flow-e2e-deposit-first')

  it('carries DEPOSIT_FIRST through deposit, SmartCA signing, activation, settlement and handover in the documented stage order', async () => {
    const context = buildContext()
    const packageSnapshot = buildHoldingPackageSnapshot()
    const feeSnapshot: Contract['feeSnapshot'] = {
      scheduleId: 'platform-fee-default',
      version: 1,
      contentHash: 'fee-hash-e2e',
      quote: [
        {
          feeKind: 'TENANT_SERVICE',
          payerRole: 'tenant',
          amountBeforeVat: 200_000,
          vatAmount: 20_000,
          amount: 220_000,
        },
        {
          feeKind: 'LANDLORD_COMMISSION',
          payerRole: 'landlord',
          amountBeforeVat: 10_000_000,
          vatAmount: 1_000_000,
          amount: 11_000_000,
        },
      ],
    }

    const { contractId, agreementId } = await provisionContract(
      context,
      'DEPOSIT_FIRST',
      packageSnapshot,
      {
        applicationId: 'app-e2e-deposit-first-1',
        feeSnapshot,
        paymentCycleMonths: 3,
      }
    )

    // ── document stage: not yet locked ──
    let view = await context.contractViewService.getForActor(
      contractId,
      tenantId,
      false
    )
    expect(view.flow?.activeStage).toBe('document')

    // ── deposit stage: consent, pay (simulating the bank callback by
    // calling the same service methods MockBankService drives) ──
    const agreementAfterCreate = await context.depositRepo.findOne({
      where: { _id: new ObjectId(agreementId) },
    })
    expect(agreementAfterCreate?.depositKind).toBe('HOLDING')
    expect(agreementAfterCreate?.amount).toBe(6_000_000)
    expect(agreementAfterCreate?.securityTopUpAmount).toBe(14_000_000)

    await context.depositAgreementsService.consent(
      agreementId,
      tenantId,
      agreementAfterCreate!.contentRevision,
      agreementAfterCreate!.contentHash
    )
    await context.depositAgreementsService.markPaymentPending(
      agreementId,
      tenantId
    )
    const paidAgreement =
      await context.depositAgreementsService.recordDepositPaid(
        agreementId,
        'attempt-e2e-deposit-1'
      )
    expect(paidAgreement.status).toBe('paid')

    const contractAfterDeposit = await context.contractRepo.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    expect(contractAfterDeposit?.depositPaidAt).toBeTruthy()
    // activateAfterDeposit is a no-op before both signatures exist.
    expect(contractAfterDeposit?.status).toBe('draft')

    view = await context.contractViewService.getForActor(
      contractId,
      tenantId,
      false
    )
    expect(view.deposit?.status).toBe('paid')
    // Per D4, the `document` stage for DEPOSIT_FIRST is done once the tenant
    // has consented to the deposit agreement (not gated on content lock), so
    // both `document` and `deposit` are already done and the active stage
    // has moved straight to `signing` even though content/artifact are not
    // locked yet (the signing stage's own blockers - CONTENT_NOT_LOCKED,
    // ARTIFACT_NOT_LOCKED - account for that).
    expect(view.flow?.activeStage).toBe('signing')

    // ── lock content + canonical artifact (signing prerequisites) ──
    const artifactHash = await lockContentAndArtifact(
      context,
      contractId,
      landlordId,
      pdfBytes
    )
    view = await context.contractViewService.getForActor(
      contractId,
      landlordId,
      false
    )
    expect(view.flow?.activeStage).toBe('signing')

    // ── signing stage: both parties sign via SmartCA ──
    const afterTenantSign =
      await context.contractsService.recordSmartCaSignature({
        contractId,
        signerId: tenantId,
        role: 'tenant',
        artifactHash,
        providerTransactionId: 'sca-tx-tenant-1',
        certificateSerial: 'cert-tenant-1',
        signedAt: new Date('2026-10-15T09:00:00.000Z'),
      })
    expect(afterTenantSign.status).toBe('awaiting-signature')

    const activated = await context.contractsService.recordSmartCaSignature({
      contractId,
      signerId: landlordId,
      role: 'landlord',
      artifactHash,
      providerTransactionId: 'sca-tx-landlord-1',
      certificateSerial: 'cert-landlord-1',
      signedAt: new Date('2026-10-15T09:05:00.000Z'),
    })

    // ── ledger stage: activation fires exactly once, with the deposit
    // dependency wired, and downstream provisioning (schedule, fee
    // invoices, settlement) runs synchronously off the same activation ──
    expect(activated.status).toBe('active')
    expect(activated.depositId).toBe(agreementId)

    const activationCalls =
      context.ledgerOutboxService.enqueue.mock.calls.filter(
        ([input]) => input.eventType === 'contract.activated'
      )
    expect(activationCalls).toHaveLength(1)
    expect(activationCalls[0]?.[0].dependencyKey).toBe(
      `deposit:${agreementId}:deposit.paid`
    )
    const depositPaidCalls =
      context.ledgerOutboxService.enqueue.mock.calls.filter(
        ([input]) => input.eventType === 'deposit.paid'
      )
    expect(depositPaidCalls).toHaveLength(1)

    // Replaying activation is idempotent (same pattern as
    // smartca-activation.integration.spec.ts).
    const replay =
      await context.contractsService.activateAfterDeposit(contractId)
    expect(replay.status).toBe('active')
    expect(
      context.ledgerOutboxService.enqueue.mock.calls.filter(
        ([input]) => input.eventType === 'contract.activated'
      )
    ).toHaveLength(1)

    // ── money model (D5): rent schedule, settlement lines, platform fees ──
    const rentPayments = await context.paymentRepo.find({
      where: { contractId, type: 'rent' },
    })
    expect(rentPayments).toHaveLength(4) // 12 months / 3-month cycle
    expect(rentPayments.every(payment => payment.amount === 30_000_000)).toBe(
      true
    )

    const settlement = await context.settlementRepo.findOne({
      where: { contractId },
    })
    expect(settlement).not.toBeNull()
    const topUpLine = settlement!.lines.find(
      line => line.kind === 'DEPOSIT_TOPUP'
    )
    const firstRentLine = settlement!.lines.find(
      line => line.kind === 'FIRST_RENT'
    )
    const tenantFeeLine = settlement!.lines.find(
      line => line.kind === 'TENANT_SERVICE_FEE'
    )
    expect(topUpLine?.amount).toBe(14_000_000)
    expect(firstRentLine?.amount).toBe(30_000_000)
    expect(tenantFeeLine?.amount).toBe(220_000)
    expect(settlement!.total).toBe(14_000_000 + 30_000_000 + 220_000)

    const feeInvoices = await context.paymentRepo.find({
      where: { contractId, type: 'platform-fee' },
    })
    expect(feeInvoices).toHaveLength(2)
    expect(
      feeInvoices.find(invoice => invoice.feeKind === 'LANDLORD_COMMISSION')
        ?.amount
    ).toBe(11_000_000)
    // The tenant-service fee invoice issued by generatePlatformFeeInvoices is
    // the SAME payment the settlement references (idempotent lookup by
    // feeKind in MoveInSettlementsService.createForContract) - not a
    // duplicate.
    expect(
      feeInvoices
        .find(invoice => invoice.feeKind === 'TENANT_SERVICE')
        ?._id.toHexString()
    ).toBe(tenantFeeLine?.paymentId)

    // The `ledger` stage only completes once the (mocked-away) outbox
    // worker / LedgerProjectionService confirms the enqueued event -
    // `ledgerOutboxService` is a bare jest mock in this fixture, so that
    // confirmation is simulated directly here, the same way the settlement
    // payment is simulated below.
    await context.contractRepo.update(
      { _id: new ObjectId(contractId) },
      { ledgerStatus: 'confirmed', ledgerRecordedAt: new Date() }
    )

    view = await context.contractViewService.getForActor(
      contractId,
      tenantId,
      false
    )
    expect(view.flow?.activeStage).toBe('move-in')
    expect(view.financialSummary.holdingDeposit).toBe(6_000_000)
    expect(view.financialSummary.securityTopUpAmount).toBe(14_000_000)

    // ── move-in stage: record + confirm handover ──
    // Simulate the settlement being paid in full via the mock-bank
    // settlement callback (`MockBankService.handleSettlementCallback`)
    // without wiring that service's full HMAC/attempt machinery, which is
    // orthogonal to this spec's focus (deposit -> signing -> activation ->
    // settlement creation -> handover). The real effect of that callback -
    // every line gets `paidAt` and the settlement flips to `paid` - is
    // reproduced directly against the settlement repository.
    const settlementBeforeHandover = await context.settlementRepo.findOne({
      where: { contractId },
    })
    settlementBeforeHandover!.lines = settlementBeforeHandover!.lines.map(
      line => ({ ...line, paidAt: new Date() })
    )
    settlementBeforeHandover!.status = 'paid'
    await context.settlementRepo.save(settlementBeforeHandover!)

    const settlementId = settlementBeforeHandover!._id.toHexString()
    const recorded = await context.moveInSettlementsService.updateHandover(
      settlementId,
      landlordId,
      {
        handedOverAt: '2026-10-30T08:00:00.000Z',
        electricity: 120,
        water: 15,
        keyCount: 2,
      }
    )
    expect(recorded.handover?.handoverHash).toBeTruthy()
    await context.moveInSettlementsService.confirmHandover(
      settlementId,
      tenantId,
      'tenant',
      recorded.handover!.handoverHash
    )
    const confirmedByBoth =
      await context.moveInSettlementsService.confirmHandover(
        settlementId,
        landlordId,
        'landlord',
        recorded.handover!.handoverHash
      )
    expect(confirmedByBoth.handover?.completedAt).toBeTruthy()

    view = await context.contractViewService.getForActor(
      contractId,
      tenantId,
      false
    )
    expect(view.settlement?.status).toBe('paid')
    expect(
      (view.settlement?.handover as { completedAt: unknown } | null)
        ?.completedAt
    ).toBeTruthy()
    expect(view.flow?.activeStage).toBe('completed')
    const stageByKey = Object.fromEntries(
      (view.flow?.stages ?? []).map(stage => [stage.key, stage.status])
    )
    expect(stageByKey).toMatchObject({
      document: 'done',
      deposit: 'done',
      signing: 'done',
      ledger: 'done',
      'move-in': 'done',
    })
  })
})

// ── 16.2: SIGN_FIRST + SmartCA + deposit after signing + RETRY_ACTIVATION ──

describe('rental flow E2E integration — SIGN_FIRST with deposit after signing and RETRY_ACTIVATION', () => {
  const tenantId = 'tenant-e2e-1'
  const landlordId = 'landlord-e2e-1'
  const pdfBytes = Buffer.from('%PDF-1.7\nrental-flow-e2e-sign-first')

  it('isolates an activation failure after deposit, keeps the deposit committed, and recovers exactly once via RETRY_ACTIVATION', async () => {
    const context = buildContext()
    const packageSnapshot = buildFullSecurityPackageSnapshot()

    const { contractId, agreementId } = await provisionContract(
      context,
      'SIGN_FIRST',
      packageSnapshot,
      { applicationId: 'app-e2e-sign-first-1' }
    )

    const artifactHash = await lockContentAndArtifact(
      context,
      contractId,
      landlordId,
      pdfBytes
    )
    const pendingDeposit = await signBothParties(
      context,
      contractId,
      tenantId,
      landlordId,
      artifactHash
    )
    expect(pendingDeposit.status).toBe('fully-signed-pending-deposit')

    // Inject a failure in the activation side-effect (ledger enqueue) that
    // only fires once, exactly like a transient outbox outage.
    context.ledgerOutboxService.failOnce(
      'contract.activated',
      'LEDGER_OUTBOX_UNAVAILABLE: simulated outage for RETRY_ACTIVATION test'
    )

    const agreement = await context.depositRepo.findOne({
      where: { _id: new ObjectId(agreementId) },
    })
    await context.depositAgreementsService.consent(
      agreementId,
      tenantId,
      agreement!.contentRevision,
      agreement!.contentHash
    )
    await context.depositAgreementsService.markPaymentPending(
      agreementId,
      tenantId
    )

    // The bank callback path must not throw, and the deposit commit must
    // not be rolled back, even though activation fails downstream.
    const paidAgreement =
      await context.depositAgreementsService.recordDepositPaid(
        agreementId,
        'attempt-e2e-sign-first-1'
      )
    expect(paidAgreement.status).toBe('paid')

    const contractAfterFailure = await context.contractRepo.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    expect(contractAfterFailure?.status).toBe('fully-signed-pending-deposit')
    expect(contractAfterFailure?.activationFailure).toMatchObject({
      code: 'LEDGER_OUTBOX_UNAVAILABLE',
    })
    expect(contractAfterFailure?.activationFailure?.message).toContain(
      'simulated outage'
    )
    expect(contractAfterFailure?.activationFailure?.at).toBeInstanceOf(Date)

    // Surfaced as a stuck transaction (D10).
    const rentalTransactionsService = new RentalTransactionsService(
      {} as never, // eventRepository - not exercised (no timeline lookup here)
      { find: jest.fn().mockResolvedValue([]) } as never, // applicationRepository
      context.contractRepo as never,
      context.depositRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never, // outboxRepository
      context.settlementRepo as never,
      { get: jest.fn().mockReturnValue({}) } as never, // configService
      {
        get: jest.fn((token: unknown) =>
          token === ContractsService ? context.contractsService : undefined
        ),
      } as never,
      undefined
    )
    const stuck = await rentalTransactionsService.listStuck()
    const stuckEntry = stuck.find(
      item => item.reasonCode === 'ACTIVATION_FAILED_AFTER_DEPOSIT'
    )
    expect(stuckEntry?.contractId).toBe(contractId)
    expect(stuckEntry?.suggestedAction).toBe('RETRY_ACTIVATION')

    // Fix the underlying condition and retry via the recovery gate.
    const recovered = await rentalTransactionsService.recover(
      contractId,
      { id: 'staff-e2e-1', role: 'staff' },
      { action: 'RETRY_ACTIVATION', reason: 'ledger outage resolved' }
    )
    expect(recovered.status).toBe('active')

    const contractAfterRetry = await context.contractRepo.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    expect(contractAfterRetry?.status).toBe('active')
    expect(contractAfterRetry?.activationKey).toBeTruthy()
    // D3: a successful activation clears any stale failure marker left by
    // the earlier failed attempt, so Contract View stops reporting it.
    expect(contractAfterRetry?.activationFailure).toBeNull()

    const activationCalls =
      context.ledgerOutboxService.enqueue.mock.calls.filter(
        ([input]) => input.eventType === 'contract.activated'
      )
    // One failed attempt + one successful attempt; activation itself only
    // ever completes once.
    expect(activationCalls).toHaveLength(2)

    // A second RETRY_ACTIVATION call is safe: the contract is no longer
    // `fully-signed-pending-deposit`, so `ContractsService.retryActivation`
    // rejects it with the activation gate's own reason code rather than
    // re-running activation.
    await expect(
      rentalTransactionsService.recover(
        contractId,
        { id: 'staff-e2e-1', role: 'staff' },
        { action: 'RETRY_ACTIVATION', reason: 'second call is a no-op' }
      )
    ).rejects.toThrow('ACTIVATION_NOT_READY')
    expect(
      context.ledgerOutboxService.enqueue.mock.calls.filter(
        ([input]) => input.eventType === 'contract.activated'
      )
    ).toHaveLength(2)
  })

  it('rejects RETRY_ACTIVATION with ACTIVATION_NOT_READY when both SmartCA signatures are not yet present', async () => {
    const context = buildContext()
    const contractId = new ObjectId()
    await context.contractRepo.save({
      _id: contractId,
      contractCode: 'HD-E2E-NOT-READY',
      status: 'awaiting-signature',
      signedByTenant: false,
      signedByLandlord: false,
      tenantId,
      landlordId,
      deposit: 10_000_000,
      monthlyRent: 5_000_000,
      executionMethod: 'SMARTCA',
    } as unknown as Contract)

    const rentalTransactionsService = new RentalTransactionsService(
      {} as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      context.contractRepo as never,
      context.depositRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      context.settlementRepo as never,
      { get: jest.fn().mockReturnValue({}) } as never,
      {
        get: jest.fn((token: unknown) =>
          token === ContractsService ? context.contractsService : undefined
        ),
      } as never,
      undefined
    )

    await expect(
      rentalTransactionsService.recover(
        contractId.toHexString(),
        { id: 'staff-e2e-1', role: 'staff' },
        { action: 'RETRY_ACTIVATION', reason: 'missing both signatures' }
      )
    ).rejects.toThrow('ACTIVATION_NOT_READY')
  })
})
