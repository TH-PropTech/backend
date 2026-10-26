import type {
  ContractFlowActionDto,
  ContractFlowActionKey,
  ContractFlowBlockerDto,
  ContractFlowDto,
  ContractFlowStageDto,
  ContractFlowStageKey,
  ContractLedgerSummaryDto,
} from '../dto/contract-view.dto'
import type { DepositAgreementStatus } from '../schemas/deposit-agreement.schema'
import {
  evaluateConsentDeposit,
  evaluateLockArtifact,
  evaluateLockContent,
  evaluatePayDeposit,
  evaluateSigning,
  type GuardResult,
} from './flow-guards'
import {
  moveOutActions,
  moveOutStage,
  projectMoveOut,
  type MoveOutFacts,
} from './move-out-flow'

type PartyRole = 'tenant' | 'landlord'
type ActorRole = PartyRole | 'staff'
type ProjectedStageKey = Exclude<ContractFlowStageKey, 'move-in' | 'move-out'>

/** Dữ kiện đã lưu mà Contract View thu thập; projector không truy vấn DB. */
export interface ContractFlowFacts {
  contractStatus: string
  executionMethod: string
  isConfigOutdated: boolean
  agreement: {
    status: DepositAgreementStatus
    hasConsent: boolean
    consentedAt: Date | null
    contentRevision: number | null
    contentHash: string | null
  } | null
  deposit: { required: boolean; confirmed: boolean; paidAt: Date | null }
  contentLockedAt: Date | null
  hasArtifact: boolean
  signatures: Record<PartyRole, { signed: boolean; signedAt: Date | null }>
  kycVerified: Record<PartyRole, boolean>
  activationFailureCode: string | null
  ledger: {
    status: ContractLedgerSummaryDto['status']
    recordedAt: Date | null
  }
  viewer: { isTenant: boolean; isLandlord: boolean; isStaff: boolean }
  settlement?: {
    required: boolean
    status: string | null
    handoverRecorded: boolean
    handoverCompleted: boolean
    completedAt: Date | null
  }
  fees?: { tenantDue: boolean; landlordDue: boolean }
  /** Biên bản trả nhà và bảng khấu trừ cọc; vắng mặt = chưa có bản ghi nào. */
  moveOut?: MoveOutFacts
}

type StageEvaluation = {
  done: boolean
  completedAt: Date | null
  /** Chặn cứng: stage đầu tiên chưa xong sẽ ở `blocked`. */
  hardBlockers: ContractFlowBlockerDto[]
  /** Báo sớm ngay cả khi stage còn `upcoming` (ví dụ KYC). */
  earlyBlockers: ContractFlowBlockerDto[]
  /** Chỉ báo khi stage đang `active`. */
  activeBlockers: ContractFlowBlockerDto[]
}

const STAGE_ORDER: ProjectedStageKey[] = [
  'document',
  'signing',
  'deposit',
  'ledger',
]
const ACTIVATED_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'terminated',
  'completed',
])
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'terminated',
  'completed',
  'cancelled',
])
const CONFIRMED_LEDGER_STATUSES: ReadonlySet<string> = new Set([
  'confirmed-fabric',
  'confirmed-simulation',
])
const CLOSED_AGREEMENT_STATUSES: ReadonlySet<DepositAgreementStatus> = new Set([
  'cancelled',
  'expired',
  'refunded',
])
const PARTY_ROLES: readonly PartyRole[] = ['tenant', 'landlord']
const ALWAYS_ENABLED: GuardResult = { enabled: true, reasonCode: null }

const blocker = (
  code: string,
  partyRole: PartyRole | null = null
): ContractFlowBlockerDto => ({ code, partyRole })

const isActivated = (facts: ContractFlowFacts): boolean =>
  ACTIVATED_STATUSES.has(facts.contractStatus)

const requiresArtifact = (facts: ContractFlowFacts): boolean =>
  facts.executionMethod === 'SMARTCA'

const evaluation = (
  done: boolean,
  completedAt: Date | null,
  blockers: Partial<Omit<StageEvaluation, 'done' | 'completedAt'>> = {}
): StageEvaluation => ({
  done,
  completedAt,
  hardBlockers: blockers.hardBlockers ?? [],
  earlyBlockers: blockers.earlyBlockers ?? [],
  activeBlockers: blockers.activeBlockers ?? [],
})

function evaluateDocument(facts: ContractFlowFacts): StageEvaluation {
  const { contentLockedAt } = facts
  const lockDone =
    contentLockedAt !== null && (!requiresArtifact(facts) || facts.hasArtifact)
  return evaluation(isActivated(facts) || lockDone, contentLockedAt)
}

function evaluateDeposit(facts: ContractFlowFacts): StageEvaluation {
  const done = facts.deposit.confirmed || isActivated(facts)
  const { agreement } = facts
  const hardBlockers: ContractFlowBlockerDto[] = []
  if (!done && agreement && CLOSED_AGREEMENT_STATUSES.has(agreement.status)) {
    hardBlockers.push(blocker('DEPOSIT_AGREEMENT_CLOSED'))
  }
  if (!done && !agreement && facts.deposit.required) {
    hardBlockers.push(blocker('DEPOSIT_AGREEMENT_MISSING'))
  }
  return evaluation(done, facts.deposit.paidAt, { hardBlockers })
}

function signingActiveBlockers(
  facts: ContractFlowFacts
): ContractFlowBlockerDto[] {
  const blockers: ContractFlowBlockerDto[] = []
  if (facts.isConfigOutdated) blockers.push(blocker('CONFIG_OUTDATED'))
  if (facts.contentLockedAt === null) {
    blockers.push(blocker('CONTENT_NOT_LOCKED'))
  } else if (requiresArtifact(facts) && !facts.hasArtifact) {
    blockers.push(blocker('ARTIFACT_NOT_LOCKED'))
  }
  return blockers
}

function evaluateSigningStage(facts: ContractFlowFacts): StageEvaluation {
  const { tenant, landlord } = facts.signatures
  const completedAt =
    tenant.signedAt && landlord.signedAt
      ? new Date(
          Math.max(tenant.signedAt.getTime(), landlord.signedAt.getTime())
        )
      : null
  const earlyBlockers = PARTY_ROLES.filter(
    role => !facts.signatures[role].signed && !facts.kycVerified[role]
  ).map(role => blocker('KYC_NOT_VERIFIED', role))
  return evaluation(
    (tenant.signed && landlord.signed) || isActivated(facts),
    completedAt,
    { earlyBlockers, activeBlockers: signingActiveBlockers(facts) }
  )
}

function evaluateLedger(facts: ContractFlowFacts): StageEvaluation {
  const done =
    isActivated(facts) && CONFIRMED_LEDGER_STATUSES.has(facts.ledger.status)
  const hardBlockers: ContractFlowBlockerDto[] = []
  if (!done && facts.activationFailureCode) {
    hardBlockers.push(blocker('ACTIVATION_FAILED'))
  } else if (!done && facts.ledger.status === 'failed-terminal') {
    hardBlockers.push(blocker('LEDGER_FAILED_TERMINAL'))
  }
  return evaluation(done, facts.ledger.recordedAt, { hardBlockers })
}

const STAGE_EVALUATORS: Record<
  ProjectedStageKey,
  (facts: ContractFlowFacts) => StageEvaluation
> = {
  document: evaluateDocument,
  deposit: evaluateDeposit,
  signing: evaluateSigningStage,
  ledger: evaluateLedger,
}

function projectStages(facts: ContractFlowFacts): ContractFlowStageDto[] {
  const terminal = TERMINAL_STATUSES.has(facts.contractStatus)
  let activeAssigned = false
  return STAGE_ORDER.map((key): ContractFlowStageDto => {
    const result = STAGE_EVALUATORS[key](facts)
    const completedAt = result.done
      ? (result.completedAt?.toISOString() ?? null)
      : null
    if (result.done) return { key, status: 'done', blockers: [], completedAt }
    if (terminal) return { key, status: 'skipped', blockers: [], completedAt }
    const early = [...result.hardBlockers, ...result.earlyBlockers]
    if (activeAssigned) {
      return { key, status: 'upcoming', blockers: early, completedAt }
    }
    activeAssigned = true
    return {
      key,
      status: result.hardBlockers.length > 0 ? 'blocked' : 'active',
      blockers: [...early, ...result.activeBlockers],
      completedAt,
    }
  })
}

const toAction = (
  action: ContractFlowActionKey,
  actorRole: ActorRole,
  stage: ContractFlowStageKey,
  guard: GuardResult
): ContractFlowActionDto => ({
  action,
  actorRole,
  enabled: guard.enabled,
  reasonCode: guard.reasonCode,
  stage,
})

function depositActions(facts: ContractFlowFacts): ContractFlowActionDto[] {
  const { agreement, deposit } = facts
  if (!agreement) return []
  const actions: ContractFlowActionDto[] = []
  if (agreement.status === 'draft') {
    const guard = evaluateConsentDeposit(agreement)
    actions.push(toAction('CONSENT_DEPOSIT', 'tenant', 'deposit', guard))
  }
  if (deposit.required && !deposit.confirmed) {
    const guard = evaluatePayDeposit(agreement)
    actions.push(toAction('PAY_DEPOSIT', 'tenant', 'deposit', guard))
  }
  return actions
}

function documentActions(
  facts: ContractFlowFacts,
  role: ActorRole
): ContractFlowActionDto[] {
  if (facts.contentLockedAt === null) {
    const guard = evaluateLockContent({
      contractStatus: facts.contractStatus,
      isContentLocked: false,
    })
    return [toAction('LOCK_CONTENT', role, 'document', guard)]
  }
  if (!requiresArtifact(facts) || facts.hasArtifact) return []
  const guard = evaluateLockArtifact({
    isContentLocked: true,
    hasArtifact: false,
  })
  return [toAction('LOCK_ARTIFACT', role, 'document', guard)]
}

function signingActions(
  facts: ContractFlowFacts,
  role: PartyRole
): ContractFlowActionDto[] {
  if (facts.signatures[role].signed) return []
  const actions: ContractFlowActionDto[] = []
  if (!facts.kycVerified[role]) {
    actions.push(toAction('COMPLETE_KYC', role, 'signing', ALWAYS_ENABLED))
  }
  const eligibility = evaluateSigning({
    isParticipant: true,
    hasSigned: false,
    isConfigOutdated: facts.isConfigOutdated,
    isContentLocked: facts.contentLockedAt !== null,
    requiresArtifact: requiresArtifact(facts),
    hasArtifact: facts.hasArtifact,
    contractStatus: facts.contractStatus,
    isKycVerified: facts.kycVerified[role],
  })
  const signAction = requiresArtifact(facts) ? 'SIGN_SMARTCA' : 'SIGN_ECONSENT'
  actions.push(
    toAction(signAction, role, 'signing', {
      enabled: eligibility.eligible,
      reasonCode: eligibility.reasonCode,
    })
  )
  return actions
}

function resolveActorRole(
  viewer: ContractFlowFacts['viewer']
): ActorRole | null {
  if (viewer.isTenant) return 'tenant'
  if (viewer.isLandlord) return 'landlord'
  if (viewer.isStaff) return 'staff'
  return null
}

function projectActions(facts: ContractFlowFacts): ContractFlowActionDto[] {
  const role = resolveActorRole(facts.viewer)
  if (!role || facts.contractStatus === 'cancelled') return []
  if (isActivated(facts)) {
    const actions = [toAction('VERIFY_LEDGER', role, 'ledger', ALWAYS_ENABLED)]
    const settlement = facts.settlement
    if (settlement?.required) {
      if (role === 'tenant' && settlement.status !== 'paid')
        actions.push(
          toAction('PAY_SETTLEMENT', role, 'move-in', {
            enabled: settlement.status !== 'cancelled',
            reasonCode:
              settlement.status === 'cancelled' ? 'SETTLEMENT_CANCELLED' : null,
          })
        )
      if (
        role === 'tenant' &&
        settlement.status === 'paid' &&
        settlement.handoverRecorded &&
        !settlement.handoverCompleted
      )
        actions.push(
          toAction('CONFIRM_HANDOVER', role, 'move-in', ALWAYS_ENABLED)
        )
      if (
        (role === 'landlord' || role === 'staff') &&
        settlement.status === 'paid' &&
        !settlement.handoverRecorded
      )
        actions.push(
          toAction('RECORD_HANDOVER', role, 'move-in', ALWAYS_ENABLED)
        )
    }
    if (!settlement?.required && role === 'tenant' && facts.fees?.tenantDue)
      actions.push(toAction('PAY_FEE', role, 'move-in', ALWAYS_ENABLED))
    if (role === 'landlord' && facts.fees?.landlordDue)
      actions.push(toAction('PAY_FEE', role, 'move-in', ALWAYS_ENABLED))
    return [
      ...actions,
      ...moveOutActions(facts.contractStatus, facts.moveOut, role),
    ]
  }
  if (role === 'staff') return documentActions(facts, role)
  if (role === 'landlord') {
    return [...documentActions(facts, role), ...signingActions(facts, role)]
  }
  return [...depositActions(facts), ...signingActions(facts, role)]
}

/**
 * Hàm thuần chiếu trạng thái luồng hợp đồng (design D4). Stage được suy từ
 * dữ kiện đã lưu, không dựa vào `deposit-pending`/`deposit-paid` vốn không
 * bao giờ được gán.
 */
export function projectContractFlow(facts: ContractFlowFacts): ContractFlowDto {
  const stages = projectStages(facts)
  const moveOutView = projectMoveOut(facts.contractStatus, facts.moveOut)
  if (facts.settlement?.required) {
    const completed =
      facts.settlement.status === 'paid' && facts.settlement.handoverCompleted
    stages.push({
      key: 'move-in',
      status: completed ? 'done' : isActivated(facts) ? 'active' : 'upcoming',
      blockers: [],
      completedAt: completed
        ? (facts.settlement.completedAt?.toISOString() ?? null)
        : null,
    })
  }
  const moveOut = moveOutStage(facts.contractStatus, facts.moveOut)
  if (moveOut) stages.push(moveOut)
  const firstOpen = stages.find(
    stage => stage.status !== 'done' && stage.status !== 'skipped'
  )
  return {
    version: 1,
    strategy: 'SIGN_FIRST',
    stages,
    activeStage: firstOpen?.key ?? 'completed',
    nextActions: projectActions(facts),
    ...(moveOutView ? { moveOut: moveOutView } : {}),
  }
}
