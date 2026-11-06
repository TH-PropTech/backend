import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { LegalProfile } from '../legal/legal-profile.resolver'
import type { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'

export class ContractPropertySnapshotDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  title!: string

  @ApiProperty({ nullable: true })
  address!: string | null

  @ApiProperty({ nullable: true })
  area!: number | null

  @ApiProperty({ nullable: true })
  furniture!: string | null

  @ApiProperty()
  value!: number
}

export class ContractCommercialSnapshotDto {
  @ApiProperty()
  monthlyRent!: number

  @ApiProperty()
  deposit!: number

  @ApiProperty()
  paymentDay!: number

  @ApiProperty({ nullable: true })
  durationMonths?: number | null

  @ApiProperty()
  latePenaltyRate!: number

  @ApiProperty()
  terminationNoticeDays!: number

  @ApiPropertyOptional({
    description: 'Người ở kèm ngoài người thuê (họ tên, năm sinh, quan hệ)',
  })
  occupants?: Array<{
    fullName: string
    birthYear: number
    relationship: string
  }>

  @ApiPropertyOptional({
    description: 'Đơn giá điện, nước, dịch vụ hai bên đã thỏa thuận',
  })
  utilityRates?: {
    electricityPerKwh: number
    waterPerM3: number
    serviceFeeMonthly: number
    note?: string
  }
}

export class ContractExecutionPolicyViewDto {
  @ApiProperty()
  policyId!: string

  @ApiProperty()
  version!: number

  @ApiProperty({ enum: ['SIGN_FIRST'] })
  strategy!: 'SIGN_FIRST'

  @ApiProperty()
  depositConfirmed!: boolean

  @ApiProperty()
  activationReady!: boolean

  @ApiProperty({ nullable: true })
  nextAction!: string | null
}

export class ContractDocumentSectionDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  number!: number

  @ApiProperty()
  title!: string

  @ApiProperty()
  content!: string

  @ApiProperty()
  protected!: boolean

  @ApiProperty()
  hash!: string

  @ApiProperty({ type: [String], required: false })
  citationIds?: string[]
}

export class ContractDocumentAnnexDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  title!: string

  @ApiProperty({ required: false })
  description?: string

  @ApiProperty()
  required!: boolean
}

export class ContractAmendmentSummaryDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  sequence!: number

  @ApiProperty()
  status!: string

  @ApiProperty()
  effectiveFrom!: string

  @ApiProperty({ nullable: true })
  contentHash!: string | null

  @ApiProperty({ nullable: true, required: false })
  artifactHash?: string | null

  @ApiProperty({ nullable: true, required: false })
  artifactId?: string | null

  @ApiProperty({ enum: ['available', 'missing'], required: false })
  artifactIntegrity?: 'available' | 'missing'

  @ApiProperty({ required: false })
  ledgerStatus?: 'not-requested' | 'pending' | 'confirmed' | 'failed'

  @ApiProperty({ nullable: true, required: false })
  ledgerTxHash?: string | null

  @ApiProperty()
  tenantSigned!: boolean

  @ApiProperty()
  landlordSigned!: boolean
}

export class ContractCanonicalArtifactDto {
  @ApiProperty()
  artifactId!: string

  @ApiProperty()
  revision!: number

  @ApiProperty()
  templateKey!: string

  @ApiProperty()
  templateVersion!: number

  @ApiProperty()
  artifactHash!: string

  @ApiProperty({ nullable: true, required: false })
  canonicalContentHash?: string | null

  @ApiProperty({ nullable: true, required: false })
  rendererVersion?: string | null

  @ApiProperty({ nullable: true, required: false })
  sourceSchemaVersion?: number | null

  @ApiProperty({ nullable: true, required: false })
  byteLength?: number | null

  @ApiProperty({ nullable: true, required: false })
  amendmentId?: string | null

  @ApiProperty({ enum: ['application/pdf'] })
  contentType!: 'application/pdf'
}

export class ContractDocumentViewDto {
  @ApiProperty({ enum: ['draft', 'locked'] })
  mode!: 'draft' | 'locked'

  @ApiProperty()
  revision!: number

  @ApiProperty({ nullable: true })
  lockedAt!: string | null

  @ApiProperty({ nullable: true })
  lockedHash!: string | null

  @ApiProperty({ nullable: true, required: false })
  contentHash?: string | null

  @ApiProperty({ type: [String], required: false })
  citationIds?: string[]

  @ApiProperty({ type: [ContractAmendmentSummaryDto], required: false })
  amendmentHistory?: ContractAmendmentSummaryDto[]

  @ApiProperty({ nullable: true, required: false })
  governingAmendmentId?: string | null

  @ApiProperty()
  hashSchemaVersion!: number

  @ApiProperty({ nullable: true })
  legalProfile!: LegalProfile | null

  @ApiProperty({ nullable: true })
  templateVersion!: string | null

  @ApiProperty({ type: [ContractDocumentSectionDto] })
  sections!: ContractDocumentSectionDto[]

  @ApiProperty({ type: [ContractDocumentAnnexDto] })
  annexes!: ContractDocumentAnnexDto[]

  @ApiProperty({ type: ContractCanonicalArtifactDto, nullable: true })
  canonicalArtifact!: ContractCanonicalArtifactDto | null

  @ApiProperty({ nullable: true, required: false })
  layout?: {
    profileKey: string
    version: number
    blocks: Array<{
      blockId: string
      order: number
      title: string
      visible: boolean
    }>
  } | null

  @ApiProperty({ type: [Object], required: false })
  supplementaryClauses?: Array<{
    id: string
    title: string
    content: string
    enabled: boolean
  }>

  @ApiProperty({ enum: ['not-locked', 'valid', 'mismatch', 'unavailable'] })
  integrity!: 'not-locked' | 'valid' | 'mismatch' | 'unavailable'
}

export class ContractPartyViewDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  name!: string

  @ApiProperty({ enum: ['tenant', 'landlord'] })
  role!: 'tenant' | 'landlord'

  @ApiProperty({ nullable: true })
  maskedCccd!: string | null

  @ApiProperty({ nullable: true })
  address!: string | null

  @ApiProperty({ enum: ['unverified', 'pending', 'verified', 'rejected'] })
  kycStatus!: 'unverified' | 'pending' | 'verified' | 'rejected'

  @ApiProperty()
  hasSigned!: boolean

  @ApiProperty({ nullable: true })
  signedAt!: string | null

  @ApiProperty({ nullable: true })
  signatureHash!: string | null

  @ApiProperty({
    enum: ['smartca', 'platform-consent', 'dev-test'],
    nullable: true,
  })
  provider!: 'smartca' | 'platform-consent' | 'dev-test' | null

  @ApiProperty({ nullable: true })
  providerTransactionId!: string | null

  @ApiProperty({ nullable: true })
  certificateSerial!: string | null

  @ApiProperty({ nullable: true })
  signatureAlgorithm!: string | null

  @ApiProperty({ nullable: true })
  signatureValueRef!: string | null

  @ApiProperty({ nullable: true })
  providerStatus!: 'pending' | 'signed' | 'rejected' | null

  @ApiProperty({ nullable: true })
  verifiedAt!: string | null
}

export class ContractDepositViewDto {
  @ApiProperty({ nullable: true })
  agreementId!: string | null

  @ApiProperty({ nullable: true })
  agreementCode!: string | null

  @ApiProperty()
  amount!: number

  @ApiProperty()
  currency!: string

  @ApiProperty({
    enum: ['draft', 'pending', 'paid', 'transferred', 'released', 'refunded'],
  })
  status!:
    | 'draft'
    | 'pending'
    | 'paid'
    | 'transferred'
    | 'released'
    | 'refunded'

  @ApiProperty()
  consentGiven!: boolean

  @ApiProperty({ nullable: true })
  contentRevision!: number | null

  @ApiProperty({ nullable: true })
  contentHash!: string | null

  @ApiProperty({ nullable: true })
  paidAt!: string | null

  @ApiProperty({ nullable: true })
  txHash!: string | null
}

export class SigningEligibilityDto {
  @ApiProperty()
  eligible!: boolean

  @ApiProperty({ nullable: true })
  reasonCode!: string | null

  @ApiProperty({ nullable: true })
  message!: string | null
}

export class ContractActionsViewDto {
  @ApiProperty()
  canPayDeposit!: boolean

  @ApiProperty({ nullable: true })
  paymentReasonCode!: string | null

  @ApiProperty({ type: SigningEligibilityDto })
  signingEligibility!: SigningEligibilityDto

  @ApiProperty()
  canDownloadArtifact!: boolean

  @ApiProperty({ nullable: true })
  artifactReasonCode!: string | null

  @ApiProperty({ default: false })
  canEditContent!: boolean

  @ApiProperty({ default: false })
  canLockContent!: boolean

  @ApiProperty({
    default: false,
    description: 'Nội dung đã khóa nhưng chưa có bản PDF chuẩn để ký số.',
  })
  canLockArtifact!: boolean
}

export class ContractAccessViewDto {
  @ApiProperty()
  canReadWorkspace!: boolean

  @ApiProperty()
  canSign!: boolean

  @ApiProperty()
  isOriginalParticipant!: boolean

  @ApiProperty()
  isSuccessorOwner!: boolean
}

export class ContractLedgerSummaryDto {
  @ApiProperty({ enum: ['simulation', 'fabric'] })
  networkMode!: 'simulation' | 'fabric'

  @ApiProperty({ enum: ['disabled', 'connected', 'unavailable'] })
  connectionState!: 'disabled' | 'connected' | 'unavailable'

  @ApiProperty({
    enum: [
      'not-requested',
      'pending',
      'processing',
      'confirmed-simulation',
      'confirmed-fabric',
      'failed-retryable',
      'failed-terminal',
      'integrity-mismatch',
    ],
  })
  status!:
    | 'not-requested'
    | 'pending'
    | 'processing'
    | 'confirmed-simulation'
    | 'confirmed-fabric'
    | 'failed-retryable'
    | 'failed-terminal'
    | 'integrity-mismatch'

  @ApiProperty({ nullable: true })
  txHash!: string | null

  @ApiProperty({ nullable: true })
  blockNumber!: number | null

  @ApiProperty({ nullable: true })
  verifiedAt!: string | null

  @ApiProperty({ nullable: true, required: false })
  onChainValid?: boolean | null
}

export class ContractOverviewSnapshotDto {
  @ApiProperty()
  id!: string

  @ApiProperty()
  code!: string

  @ApiProperty()
  status!: string

  @ApiProperty({ type: ContractPropertySnapshotDto })
  property!: ContractPropertySnapshotDto

  @ApiProperty({ type: ContractCommercialSnapshotDto })
  commercial!: ContractCommercialSnapshotDto

  @ApiProperty()
  startDate!: string

  @ApiProperty()
  endDate!: string

  @ApiProperty()
  executionMethod!: string

  @ApiProperty()
  notarizationStatus!: string

  @ApiProperty({ type: ContractExecutionPolicyViewDto })
  executionPolicy!: ContractExecutionPolicyViewDto
}

export class ContractPartiesEnrichedDto {
  @ApiProperty({ type: ContractPartyViewDto })
  tenant!: ContractPartyViewDto

  @ApiProperty({ type: ContractPartyViewDto })
  landlord!: ContractPartyViewDto
}

export const CONTRACT_FLOW_STAGE_KEYS = [
  'document',
  'deposit',
  'signing',
  'ledger',
  'move-in',
  'move-out',
] as const
export type ContractFlowStageKey = (typeof CONTRACT_FLOW_STAGE_KEYS)[number]

export const CONTRACT_FLOW_STAGE_STATUSES = [
  'done',
  'active',
  'upcoming',
  'blocked',
  'skipped',
] as const
export type ContractFlowStageStatus =
  (typeof CONTRACT_FLOW_STAGE_STATUSES)[number]

export const CONTRACT_FLOW_ACTIONS = [
  'CONSENT_DEPOSIT',
  'PAY_DEPOSIT',
  'LOCK_CONTENT',
  'LOCK_ARTIFACT',
  'COMPLETE_KYC',
  'SIGN_SMARTCA',
  'SIGN_ECONSENT',
  'PAY_SETTLEMENT',
  'PAY_FEE',
  'RECORD_HANDOVER',
  'CONFIRM_HANDOVER',
  'VERIFY_LEDGER',
  'RECORD_MOVE_OUT_HANDOVER',
  'CONFIRM_MOVE_OUT_HANDOVER',
  'REPORT_MOVE_OUT_DISCREPANCY',
  'CREATE_DEPOSIT_STATEMENT',
  'RESPOND_DEPOSIT_STATEMENT',
  'RECORD_DEPOSIT_REFUND',
  'ACKNOWLEDGE_DEPOSIT_REFUND',
] as const
export type ContractFlowActionKey = (typeof CONTRACT_FLOW_ACTIONS)[number]

export class ContractFlowBlockerDto {
  @ApiProperty()
  code!: string

  @ApiProperty({ enum: ['tenant', 'landlord'], nullable: true })
  partyRole!: 'tenant' | 'landlord' | null
}

export class ContractFlowStageDto {
  @ApiProperty({ enum: CONTRACT_FLOW_STAGE_KEYS })
  key!: ContractFlowStageKey

  @ApiProperty({ enum: CONTRACT_FLOW_STAGE_STATUSES })
  status!: ContractFlowStageStatus

  @ApiProperty({ type: [ContractFlowBlockerDto] })
  blockers!: ContractFlowBlockerDto[]

  @ApiProperty({ nullable: true })
  completedAt!: string | null
}

export class ContractFlowActionDto {
  @ApiProperty({ enum: CONTRACT_FLOW_ACTIONS })
  action!: ContractFlowActionKey

  @ApiProperty({ enum: ['tenant', 'landlord', 'staff'] })
  actorRole!: 'tenant' | 'landlord' | 'staff'

  @ApiProperty()
  enabled!: boolean

  @ApiProperty({ nullable: true })
  reasonCode!: string | null

  @ApiProperty({
    enum: CONTRACT_FLOW_STAGE_KEYS,
    description: 'Stage có panel thực hiện hành động này',
  })
  stage!: ContractFlowStageKey
}

/** Giai đoạn kết thúc thuê, suy ra từ hai collection mới; không phải `contract.status`. */
export const MOVE_OUT_PHASES = [
  'awaiting-move-out',
  'awaiting-deposit-settlement',
  'settled',
] as const
export type MoveOutPhase = (typeof MOVE_OUT_PHASES)[number]

export class ContractFlowMoveOutDto {
  @ApiProperty({ enum: MOVE_OUT_PHASES })
  phase!: MoveOutPhase

  @ApiProperty({
    description:
      'Biên bản trả nhà hoặc bảng khấu trừ đang ở trạng thái disputed',
  })
  disputed!: boolean

  @ApiProperty({ enum: ['recorded', 'completed', 'disputed'], nullable: true })
  handoverStatus!: 'recorded' | 'completed' | 'disputed' | null

  @ApiProperty({
    enum: [
      'draft',
      'awaiting-tenant',
      'accepted',
      'disputed',
      'refund-recorded',
      'closed',
    ],
    nullable: true,
  })
  statementStatus!:
    | 'draft'
    | 'awaiting-tenant'
    | 'accepted'
    | 'disputed'
    | 'refund-recorded'
    | 'closed'
    | null
}

export class ContractFlowDto {
  @ApiProperty({ example: 1 })
  version!: 1

  @ApiProperty({ enum: ['SIGN_FIRST'] })
  strategy!: 'SIGN_FIRST'

  @ApiProperty({ type: [ContractFlowStageDto] })
  stages!: ContractFlowStageDto[]

  @ApiProperty({ enum: [...CONTRACT_FLOW_STAGE_KEYS, 'completed'] })
  activeStage!: ContractFlowStageKey | 'completed'

  @ApiProperty({
    type: [ContractFlowActionDto],
    description: 'Chỉ gồm hành động của danh tính JWT hiện tại',
  })
  nextActions!: ContractFlowActionDto[]

  @ApiProperty({
    type: ContractFlowMoveOutDto,
    required: false,
    description: 'Chỉ có khi hợp đồng đã vào giai đoạn kết thúc thuê',
  })
  moveOut?: ContractFlowMoveOutDto
}

export class ContractViewDto {
  @ApiProperty({ type: ContractOverviewSnapshotDto })
  contract!: ContractOverviewSnapshotDto

  @ApiProperty({ type: ContractDocumentViewDto })
  document!: ContractDocumentViewDto

  @ApiProperty({ type: ContractPartiesEnrichedDto })
  parties!: ContractPartiesEnrichedDto

  @ApiProperty({ type: ContractDepositViewDto, nullable: true })
  deposit!: ContractDepositViewDto | null

  @ApiProperty({ type: ContractActionsViewDto })
  actions!: ContractActionsViewDto

  @ApiProperty({ type: ContractAccessViewDto })
  access!: ContractAccessViewDto

  @ApiProperty({ type: ContractLedgerSummaryDto })
  ledger!: ContractLedgerSummaryDto

  @ApiProperty({ type: ContractFlowDto, required: false })
  flow?: ContractFlowDto

  @ApiProperty({ nullable: true })
  settlement!: {
    id: string
    status: string
    total: number
    dueAt: string
    statementHash: string
    lines: Array<{ kind: string; amount: number; paymentId: string | null }>
    /** Gồm cả `inventoryItems`, `discrepancies`, `responseDueAt`, `completionReason` (phương án A). */
    handover: MoveInSettlement['handover']
  } | null

  @ApiProperty()
  financialSummary!: {
    initialPaymentTotal: number
    holdingDeposit: number
    securityTopUpAmount: number
    tenantServiceFee: number
    landlordCommission: number
    /** Tiền thuê trả trước đã ghi trong hợp đồng; null với hợp đồng cũ chưa có chính sách này. */
    prepaidRent: {
      policy: 'NONE' | 'MONTHS' | 'FULL'
      months: number
      amount: number
    } | null
  }
}
