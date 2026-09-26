import { ApiProperty } from '@nestjs/swagger'
import type { LegalProfile } from '../legal/legal-profile.resolver'

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
}

export class ContractExecutionPolicyViewDto {
  @ApiProperty()
  policyId!: string

  @ApiProperty()
  version!: number

  @ApiProperty({ enum: ['DEPOSIT_FIRST', 'SIGN_FIRST'] })
  strategy!: 'DEPOSIT_FIRST' | 'SIGN_FIRST'

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

  @ApiProperty({ enum: ['smartca', 'platform-consent'], nullable: true })
  provider!: 'smartca' | 'platform-consent' | null

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

  @ApiProperty({ enum: ['draft', 'pending', 'paid', 'transferred'] })
  status!: 'draft' | 'pending' | 'paid' | 'transferred'

  @ApiProperty()
  consentGiven!: boolean

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
}
