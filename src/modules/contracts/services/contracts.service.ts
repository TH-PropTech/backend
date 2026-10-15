import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { User } from '../../users/schemas/user.schema'
import { isTestSignBypassEnabled } from '../utils/test-sign-bypass'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as crypto from 'crypto'
import { Contract, ContractSignature } from '../schemas/contract.schema'
import { ContractAmendmentStore } from './contract-amendment.store'
import { SmartCaSigningSession } from '../schemas/smartca-signing-session.schema'
import {
  KindScopedSmartCaSigningRepository,
  type SigningGrantDoc,
} from '../utils/signing-session.repository'
import { DepositAgreement } from '../schemas/deposit-agreement.schema'
import {
  consumeSigningGrant,
  createSigningGrant,
  hashGrantId,
} from '../utils/signing-grant.util'
import { PoliciesService } from '../../legal/services/policies.service'
import { FabricService } from '../../fabric/services/fabric.service'
import { KycService } from '../../users/services/kyc.service'
import { EkycProxyService } from '../../ekyc/services/ekyc-proxy.service'
import { KycMediaService } from '../../users/services/kyc-media.service'
import { sanitizeTipTapContent } from '../legal/tiptap-content'
import {
  buildPublicServiceChecklist,
  parsePublicServiceChecklistPurpose,
  type PublicServiceChecklist,
} from '../legal/public-service-checklist'
import { Apartment } from '../../properties/schemas/apartment.schema'
import { LedgerOutboxService } from '../../fabric/services/ledger-outbox.service'
import { PaymentsService } from '../../payments/services/payments.service'
import type { RentalPackageSnapshot } from '../../properties/utils/rental-package.util'
import type { RentalExecutionPolicyRef } from '../../rental/utils/rental-execution-policy.util'
import { BiometricEvidenceService } from '../../ekyc/services/biometric-evidence.service'
import { SmartOtpService } from '../../auth/services/smart-otp.service'
import {
  ContractArtifactService,
  requireCanonicalArtifactReference,
} from './contract-artifact.service'
import {
  buildSignedContractLedgerEvidence,
  buildSignedContractLedgerEvidenceV3,
  hashSignedContractLedgerEvidence,
  type SignedContractGovernanceReference,
} from '../../fabric/utils/ledger-evidence-envelope'
import { FabricGovernanceService } from '../../fabric/services/fabric-governance.service'
import { ContractTemplateGovernanceService } from '../legal/contract-template-governance.service'
import {
  buildCanonicalContractPayload,
  hashCanonicalContractPayload,
  CONTRACT_CONTENT_HASH_SCHEMA_VERSION,
} from '../legal/contract-canonical-payload'
import { resolveDepositConfirmation } from './deposit-confirmation.resolver'
import { evaluateLockContent, isDepositGateOpen } from '../flow/flow-guards'
import { FlowNotificationService } from '../flow/flow-notification.service'
import { resolveEffectiveCommercial } from '../commercial/resolve-effective-commercial'
import { MoveInSettlementsService } from '../../rental/services/move-in-settlements.service'
import { ContractLayoutService } from '../layout/contract-layout.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../../rental/schemas/rental-transaction-event.schema'

// ── Interfaces ──

interface CreateContractInput {
  propertyId: string
  propertyTitle: string
  propertyAddress?: string
  propertyArea?: number
  propertyFurniture?: string
  propertyValue: number
  landlordId: string
  landlordName?: string
  landlordCccd?: string
  landlordAddress?: string
  tenantId: string
  tenantName?: string
  tenantCccd?: string
  tenantAddress?: string
  startDate: string
  endDate: string
  monthlyRent: number
  deposit: number
  paymentDay: number
  latePenaltyRate: number
  terminationNoticeDays: number
}

export interface CreateContractFromApplicationInput {
  rentalApplicationId: string
  depositAgreementId: string
  propertyId: string
  propertyTitle: string
  propertyAddress: string | null
  propertyArea: number | null
  propertyFurniture: string | null
  landlordId: string
  tenantId: string
  moveInDate: Date
  packageSnapshot: RentalPackageSnapshot
  paymentCycleMonths?: 1 | 3 | 6
  feeSnapshot?: Contract['feeSnapshot']
  executionPolicySnapshot?: RentalExecutionPolicyRef | null
  applicationReviewHash?: string | null
  termsRef?: {
    key: string
    version: number
    contentHash: string
  } | null
  flowProfileRef?: {
    profileId: string
    version: number
    hash: string
  } | null
}

/** Kết quả từ chaincode verifyContract */
interface ChainVerifyResult {
  valid: boolean
  reason: 'MATCH' | 'HASH_MISMATCH' | 'NOT_FOUND'
  onChainHash?: string
  txId?: string
  recordedAt?: string
}

type IntegrityLayerStatus =
  | 'valid'
  | 'mismatch'
  | 'not-recorded'
  | 'unavailable'

interface IntegrityLayer {
  status: IntegrityLayerStatus
  hash: string | null
  reason?: string | null
}

// ── Service ──

export type SmartCaSignatureRecordInput = {
  contractId: string
  signerId: string
  role: 'tenant' | 'landlord'
  artifactHash: string
  providerTransactionId: string
  certificateSerial: string
  certificateSubject?: string | null
  certificateIssuer?: string | null
  signatureHash?: string | null
  signatureAlgorithm?: string | null
  signatureValueRef?: string | null
  providerStatus?: 'pending' | 'signed' | 'rejected' | null
  verifiedAt?: Date | null
  signedAt: Date
}

/** "ngày cấp, nơi cấp" của CCCD từ hồ sơ eKYC; null nếu thiếu cả hai. */
function describeIdIssuance(kyc: {
  issueDate?: string
  placeOfIssue?: string
}): string | null {
  const parts = [
    kyc.issueDate ? `cấp ngày ${kyc.issueDate}` : '',
    kyc.placeOfIssue ? `tại ${kyc.placeOfIssue}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name)
  /** Vé ký (kind='grant') trên bảng SmartCa hợp nhất; xem migration 028. */
  private readonly signingGrantRepository: KindScopedSmartCaSigningRepository<SigningGrantDoc>

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SmartCaSigningSession)
    signingGrantStore: Repository<SmartCaSigningSession>,
    @InjectRepository(DepositAgreement)
    private readonly depositAgreementRepository: Repository<DepositAgreement>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,

    private readonly policiesService: PoliciesService,
    private readonly fabricService: FabricService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    private readonly kycService: KycService,
    private readonly ekycProxyService: EkycProxyService,
    private readonly kycMediaService: KycMediaService,
    @Optional() private readonly paymentsService?: PaymentsService,
    @Optional()
    private readonly biometricEvidenceService?: BiometricEvidenceService,
    @Optional() private readonly smartOtpService?: SmartOtpService,
    @Optional()
    private readonly templateGovernanceService?: ContractTemplateGovernanceService,
    @Optional()
    private readonly amendmentRepository?: ContractAmendmentStore,
    @Optional()
    private readonly flowNotificationService?: FlowNotificationService,
    @Optional()
    private readonly moveInSettlementsService?: MoveInSettlementsService,
    @Optional() private readonly layoutService?: ContractLayoutService,
    @Optional() private readonly artifactService?: ContractArtifactService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService,
    @Optional()
    private readonly governanceService?: FabricGovernanceService,
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>
  ) {
    this.signingGrantRepository =
      new KindScopedSmartCaSigningRepository<SigningGrantDoc>(
        signingGrantStore,
        'grant'
      )
  }

  private async recordTransactionEvent(input: {
    contractId: string
    applicationId?: string | null
    eventType: string
    actorRole: RentalTransactionActorRole
    actorId?: string | null
    reasonCode?: string | null
    refs?: Record<string, string>
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: input.applicationId ?? input.contractId,
        applicationId: input.applicationId ?? null,
        contractId: input.contractId,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        reasonCode: input.reasonCode ?? null,
        refs: { contractId: input.contractId, ...(input.refs ?? {}) },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for contract [${input.contractId}] event [${input.eventType}]: ${message}`
      )
    }
  }

  private buildCreateContractArgs(input: {
    contractId: string
    contractCode: string
    tenantId: string
    landlordId: string
    contractHash: string
    monthlyRent: string
    startDate: string
    depositId?: string | null | undefined
    depositHash?: string | null | undefined
    evidenceJson?: string | undefined
    /** PROP-399: evidence có governance không được bị bỏ rơi bởi args ABI v1 → luôn dạng v2. */
    requireAbiV2?: boolean | undefined
  }): { args: string[]; argsVersion: 1 | 2 } {
    const argsVersion = input.requireAbiV2
      ? 2
      : this.fabricService.getChaincodeAbiVersion()
    const baseArgs = [
      input.contractId,
      input.contractCode,
      input.tenantId,
      input.landlordId,
      input.contractHash,
      input.monthlyRent,
      input.startDate,
    ]

    if (argsVersion === 1) {
      if (input.depositId && input.depositHash) {
        baseArgs.push(input.depositId, input.depositHash)
      }
      return { args: baseArgs, argsVersion }
    }

    return {
      args: [
        ...baseArgs,
        input.depositId ?? '',
        input.depositHash ?? '',
        input.evidenceJson ?? '',
      ],
      argsVersion,
    }
  }

  /**
   * PROP-399 D2: gắn snapshot governance eligible mới nhất (theo executionPolicySnapshot
   * của chính hợp đồng) vào hợp đồng đang kích hoạt. Tham chiếu bất biến sau khi gán và
   * được persist TRƯỚC khi enqueue evidence. Không có snapshot → null (hành vi cũ).
   */
  private async bindGovernanceSnapshot(
    contract: Contract
  ): Promise<SignedContractGovernanceReference | null> {
    if (contract.governanceSnapshotRef) return contract.governanceSnapshotRef
    const policy = contract.executionPolicySnapshot
    if (!this.governanceService || !policy?.policyId) return null

    const snapshot =
      await this.governanceService.findLatestEligibleForExecutionPolicy({
        policyId: policy.policyId,
        version: policy.version,
      })
    if (!snapshot) return null

    const reference: SignedContractGovernanceReference = {
      snapshotId: snapshot._id.toHexString(),
      version: snapshot.version,
      manifestHash: snapshot.manifestHash,
    }
    contract.governanceSnapshotRef = reference
    await this.contractRepository.update(
      { _id: contract._id },
      { governanceSnapshotRef: reference }
    )
    return reference
  }

  // ── Private helpers ──

  /**
   * Tính SHA-256 của payload hợp đồng.
   * Dùng chung cho signContract() và verifyIntegrity() để đảm bảo tính nhất quán.
   */
  private buildContractHash(
    contract: Contract,
    policies: Record<string, string>
  ): string {
    const payload = JSON.stringify({
      contractCode: contract.contractCode,
      propertyId: contract.propertyId,
      propertyTitle: contract.propertyTitle,
      propertyAddress: contract.propertyAddress,
      propertyArea: contract.propertyArea,
      landlordId: contract.landlordId,
      landlordName: contract.landlordName,
      landlordCccd: contract.landlordCccd,
      tenantId: contract.tenantId,
      tenantName: contract.tenantName,
      tenantCccd: contract.tenantCccd,
      monthlyRent: contract.monthlyRent,
      deposit: contract.deposit,
      latePenaltyRate: contract.latePenaltyRate,
      terminationNoticeDays: contract.terminationNoticeDays,
      startDate: contract.startDate,
      endDate: contract.endDate,
      appliedPolicies: policies,
    })
    return crypto.createHash('sha256').update(payload).digest('hex')
  }

  private async projectApartmentRental(contract: Contract): Promise<void> {
    if (!ObjectId.isValid(contract.propertyId)) return
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(contract.propertyId) },
    })
    if (!apartment) return
    apartment.status = 'rented'
    const reservation = apartment.rentalReservation
    if (
      reservation &&
      reservation.applicationId === contract.rentalApplicationId
    ) {
      reservation.contractId = contract._id.toHexString()
      reservation.leaseActivatedAt = new Date()
    }
    await this.apartmentRepository.save(apartment)
  }

  // ── Tạo draft từ application snapshot — không mở payment/signing ──

  async createDraftFromApplication(
    input: CreateContractFromApplicationInput
  ): Promise<Contract> {
    const existing = await this.contractRepository.findOne({
      where: { rentalApplicationId: input.rentalApplicationId },
    })
    if (existing) return existing

    const startDate = new Date(input.moveInDate)
    const endDate = new Date(startDate)
    endDate.setMonth(endDate.getMonth() + input.packageSnapshot.durationMonths)
    const contract = new Contract()
    contract.contractCode = `HD-APP-${input.rentalApplicationId}`
    contract.propertyId = input.propertyId
    contract.propertyTitle = input.propertyTitle
    contract.propertyAddress = input.propertyAddress
    contract.propertyArea = input.propertyArea
    contract.propertyFurniture = input.propertyFurniture
    contract.propertyValue = 0
    contract.landlordId = input.landlordId
    contract.landlordName = null
    contract.landlordCccd = null
    contract.landlordAddress = null
    contract.tenantId = input.tenantId
    contract.tenantName = null
    contract.tenantCccd = null
    contract.tenantAddress = null
    contract.startDate = startDate
    contract.endDate = endDate
    contract.durationMonths = input.packageSnapshot.durationMonths
    contract.paymentCycleMonths = input.paymentCycleMonths ?? 1
    contract.monthlyRent = input.packageSnapshot.monthlyRent
    contract.deposit = input.packageSnapshot.resolvedDepositAmount
    contract.paymentDay = 1
    contract.latePenaltyRate = 0
    contract.terminationNoticeDays = 30
    contract.status = 'draft'
    contract.legacyFlow = false
    contract.signedByTenant = false
    contract.signedByLandlord = false
    contract.contractHash = null
    contract.blockchainAddress = null
    contract.appliedPolicies = null
    contract.rentalApplicationId = input.rentalApplicationId
    contract.depositAgreementId = input.depositAgreementId
    contract.depositId = null
    contract.depositPaidAt = null
    contract.depositTxHash = null
    contract.depositAgreementCode = null
    contract.packageSnapshot = input.packageSnapshot
    contract.feeSnapshot = input.feeSnapshot ?? null
    contract.executionPolicySnapshot =
      input.executionPolicySnapshot ??
      input.packageSnapshot.defaultExecutionPolicy ??
      null
    contract.applicationReviewHash = input.applicationReviewHash ?? null
    contract.termsRef = input.termsRef ?? null
    contract.contractTemplateRef = input.termsRef?.key.startsWith('VN_')
      ? input.termsRef
      : await this.resolveCanonicalTemplateRef()
    contract.flowProfileRef = input.flowProfileRef ?? null
    contract.configStatus = 'CURRENT'
    contract.contentRevision = 0
    contract.editorContent = null
    contract.contentLockedHash = null
    contract.contentLockedAt = null
    contract.hashSchemaVersion = 1
    contract.activationKey = null
    contract.tenantSignature = null
    contract.landlordSignature = null
    return this.contractRepository.save(contract)
  }

  // ── Tạo hợp đồng mới — validate theo chính sách pháp luật ──

  async createContract(input: CreateContractInput): Promise<Contract> {
    // Bước 1: Đọc chính sách pháp luật hiện hành từ MongoDB
    const [maxInterestRate, minNoticeDays, maxDepositPercent] =
      await Promise.all([
        this.policiesService.getValue(
          'MAX_LATE_PAYMENT_INTEREST_RATE_YEAR',
          '20'
        ),
        this.policiesService.getValue('MIN_TERMINATION_NOTICE_DAYS', '30'),
        this.policiesService.getValue('MAX_DEPOSIT_LIMIT_PERCENT', '5'),
      ])

    // Bước 2: Kiểm tra tuân thủ pháp luật (Compliance Check)
    const violations: string[] = []

    if (input.latePenaltyRate > Number(maxInterestRate)) {
      violations.push(
        `Lãi suất phạt chậm đóng ${input.latePenaltyRate}%/năm vượt mức tối đa ${maxInterestRate}%/năm ` +
          `theo Khoản 1 Điều 468 Bộ luật Dân sự 2015`
      )
    }

    if (input.terminationNoticeDays < Number(minNoticeDays)) {
      violations.push(
        `Thời hạn báo trước chấm dứt ${input.terminationNoticeDays} ngày thấp hơn tối thiểu ${minNoticeDays} ngày ` +
          `theo Khoản 3 Điều 130 Luật Nhà ở 2023`
      )
    }

    if (input.propertyValue > 0) {
      const depositPercent = (input.deposit / input.propertyValue) * 100
      if (depositPercent > Number(maxDepositPercent)) {
        violations.push(
          `Tiền cọc ${input.deposit.toLocaleString('vi-VN')}đ chiếm ${depositPercent.toFixed(1)}% giá trị tài sản, ` +
            `vượt mức tối đa ${maxDepositPercent}% theo Khoản 5 Điều 23 Luật KDBDS 2023`
        )
      }
    }

    const start = new Date(input.startDate)
    const end = new Date(input.endDate)
    if (end <= start) {
      violations.push('Ngày kết thúc hợp đồng phải sau ngày bắt đầu')
    }

    if (violations.length > 0) {
      throw new BadRequestException({
        message: 'Hợp đồng vi phạm quy định pháp luật',
        violations,
      })
    }

    // Bước 3: Tạo mã hợp đồng duy nhất
    const contractCode = `HD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

    // Bước 4: Lưu hợp đồng vào MongoDB
    const contract = new Contract()
    contract.contractCode = contractCode
    contract.propertyId = input.propertyId
    contract.propertyTitle = input.propertyTitle
    contract.propertyAddress = input.propertyAddress ?? null
    contract.propertyArea = input.propertyArea ?? null
    contract.propertyFurniture = input.propertyFurniture ?? null
    contract.propertyValue = input.propertyValue
    contract.landlordId = input.landlordId
    contract.landlordName = input.landlordName ?? null
    contract.landlordCccd = input.landlordCccd ?? null
    contract.landlordAddress = input.landlordAddress ?? null
    contract.tenantId = input.tenantId
    contract.tenantName = input.tenantName ?? null
    contract.tenantCccd = input.tenantCccd ?? null
    contract.tenantAddress = input.tenantAddress ?? null
    contract.startDate = start
    contract.endDate = end
    contract.monthlyRent = input.monthlyRent
    contract.deposit = input.deposit
    contract.paymentDay = input.paymentDay
    contract.latePenaltyRate = input.latePenaltyRate
    contract.terminationNoticeDays = input.terminationNoticeDays
    contract.status = 'awaiting-signature'
    contract.signedByTenant = false
    contract.signedByLandlord = false
    contract.contractHash = null
    contract.blockchainAddress = null
    contract.appliedPolicies = null
    contract.contractTemplateRef = await this.resolveCanonicalTemplateRef()
    contract.contentRevision = 0
    contract.editorContent = null
    contract.contentLockedHash = null
    contract.contentLockedAt = null
    contract.hashSchemaVersion = 1
    contract.termsRef = null
    contract.commercialDraft = null
    contract.commercialRevision = 0

    const saved = await this.contractRepository.save(contract)
    this.logger.log(`Contract created: ${contractCode}`)
    return saved
  }

  // ── Ký hợp đồng — snapshot chính sách & đẩy lên blockchain ──

  async signContractForUser(
    contractId: string,
    userId: string,
    signingGrantId: string
  ): Promise<Contract> {
    const contract = await this.findOne(contractId)
    const role =
      contract.tenantId === userId
        ? 'tenant'
        : contract.landlordId === userId
          ? 'landlord'
          : null
    if (!role) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (!contract.contentLockedHash) {
      throw new BadRequestException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    const grant = await this.signingGrantRepository.findOne({
      where: { tokenHash: hashGrantId(signingGrantId) },
    })
    if (!grant) throw new BadRequestException('SIGNING_GRANT_INVALID')

    const consumed = consumeSigningGrant(
      grant,
      signingGrantId,
      {
        userId,
        role,
        contractId,
        contentLockedHash: contract.contentLockedHash,
        biometricGrantId: grant.biometricGrantId,
        otpSessionId: grant.otpSessionId,
      },
      new Date()
    )
    grant.consumedAt = consumed.consumedAt
    await this.signingGrantRepository.save(grant)
    const signed = await this.signContract(contractId, role)
    await this.flowNotificationService?.notifyForContract(contractId)
    return signed
  }

  /**
   * Chỉ dành cho dev/test: ký bỏ qua SmartCA, sinh trắc và Smart OTP để đi tiếp các bước sau
   * khi đang chờ tích hợp. Cần đồng thời NODE_ENV != production và ENABLE_TEST_SIGN_BYPASS=true.
   */
  async signContractForTest(
    contractId: string,
    userId: string
  ): Promise<Contract> {
    if (!isTestSignBypassEnabled()) {
      throw new ForbiddenException('TEST_SIGN_BYPASS_DISABLED')
    }
    const contract = await this.findOne(contractId)
    const role =
      contract.tenantId === userId
        ? 'tenant'
        : contract.landlordId === userId
          ? 'landlord'
          : null
    if (!role) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (!contract.contentLockedHash) {
      throw new BadRequestException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    await this.signContract(contractId, role)
    // Ghi dấu vết ký thử nghiệm để giao diện hiển thị thời điểm và nhãn "Ký thử nghiệm" thay vì để trống.
    const afterSign = await this.findOne(contractId)
    const signedAt = new Date()
    const evidence: ContractSignature = {
      signerId: userId,
      role,
      signedAt,
      contentHash: afterSign.contentLockedHash ?? '',
      provider: 'dev-test',
      providerStatus: 'signed',
      artifactHash: afterSign.artifactRef?.artifactHash ?? null,
      verifiedAt: signedAt,
    }
    if (role === 'tenant') afterSign.tenantSignature = evidence
    else afterSign.landlordSignature = evidence
    const saved = await this.contractRepository.save(afterSign)
    await this.flowNotificationService?.notifyForContract(contractId)
    return saved
  }

  async recordSmartCaSignature(
    input: SmartCaSignatureRecordInput
  ): Promise<Contract> {
    const recorded = await this.applySmartCaSignature(input)
    await this.flowNotificationService?.notifyForContract(input.contractId)
    return recorded
  }

  private async applySmartCaSignature(
    input: SmartCaSignatureRecordInput
  ): Promise<Contract> {
    const contract = await this.findOne(input.contractId)
    const expectedSignerId =
      input.role === 'tenant' ? contract.tenantId : contract.landlordId
    if (input.signerId !== expectedSignerId) {
      throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    }
    if (
      !contract.contentLockedHash ||
      !contract.artifactRef ||
      contract.artifactRef.contentType !== 'application/pdf' ||
      input.artifactHash !== contract.artifactRef.artifactHash
    ) {
      throw new ConflictException('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    }
    requireCanonicalArtifactReference(contract)
    if (!input.providerTransactionId || !input.certificateSerial) {
      throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    }

    const currentSignature =
      input.role === 'tenant'
        ? contract.tenantSignature
        : contract.landlordSignature
    if (
      currentSignature?.provider === 'smartca' &&
      currentSignature.providerTransactionId !== input.providerTransactionId
    ) {
      throw new ConflictException('SMARTCA_SIGNATURE_ALREADY_RECORDED')
    }

    const signature: ContractSignature = {
      signerId: input.signerId,
      role: input.role,
      signedAt: input.signedAt,
      contentHash: input.artifactHash,
      biometricGrantId: null,
      otpSessionId: null,
      provider: 'smartca',
      providerTransactionId: input.providerTransactionId,
      certificateSerial: input.certificateSerial,
      certificateSubject: input.certificateSubject ?? null,
      certificateIssuer: input.certificateIssuer ?? null,
      signatureHash: input.signatureHash ?? null,
      signatureAlgorithm: input.signatureAlgorithm ?? null,
      signatureValueRef: input.signatureValueRef ?? null,
      artifactHash: input.artifactHash,
      providerStatus: input.providerStatus ?? 'signed',
      verifiedAt: input.verifiedAt ?? new Date(),
    }
    if (input.role === 'tenant') {
      contract.tenantSignature = signature
      contract.signedByTenant = true
    } else {
      contract.landlordSignature = signature
      contract.signedByLandlord = true
    }
    contract.executionMethod = 'SMARTCA'

    await this.recordTransactionEvent({
      contractId: input.contractId,
      applicationId: contract.rentalApplicationId ?? null,
      eventType: 'contract.signed',
      actorRole: input.role,
      actorId: input.signerId,
      transitionKey: `contract:${input.contractId}:signed:${input.role}:${input.providerTransactionId}`,
    })

    if (
      !this.hasValidSmartCaSignature(contract, 'tenant') ||
      !this.hasValidSmartCaSignature(contract, 'landlord')
    ) {
      return this.contractRepository.save(contract)
    }

    if (!(await this.isDepositConfirmed(contract))) {
      contract.status = 'fully-signed-pending-deposit'
      return this.contractRepository.save(contract)
    }

    return this.activateSmartCaContract(contract)
  }

  private hasValidSmartCaSignature(
    contract: Contract,
    role: 'tenant' | 'landlord'
  ): boolean {
    const signature =
      role === 'tenant' ? contract.tenantSignature : contract.landlordSignature
    const expectedSignerId =
      role === 'tenant' ? contract.tenantId : contract.landlordId
    return Boolean(
      signature &&
      signature.provider === 'smartca' &&
      signature.role === role &&
      signature.signerId === expectedSignerId &&
      signature.contentHash === contract.artifactRef?.artifactHash &&
      signature.providerTransactionId &&
      signature.certificateSerial &&
      signature.signedAt &&
      !Number.isNaN(new Date(signature.signedAt).getTime())
    )
  }

  private async activateSmartCaContract(contract: Contract): Promise<Contract> {
    if (
      !this.hasValidSmartCaSignature(contract, 'tenant') ||
      !this.hasValidSmartCaSignature(contract, 'landlord')
    ) {
      throw new ConflictException('SMARTCA_SIGNATURES_REQUIRED')
    }
    if (contract.status === 'active' && contract.activationKey) {
      return contract
    }

    const depositAgreement =
      await this.findDepositAgreementForContract(contract)
    if (contract.deposit > 0) {
      if (
        !depositAgreement ||
        !['paid', 'applied-to-lease-security'].includes(depositAgreement.status)
      ) {
        contract.status = 'fully-signed-pending-deposit'
        return this.contractRepository.save(contract)
      }
      if (!depositAgreement.depositHash) {
        throw new ConflictException('DEPOSIT_HASH_REQUIRED_FOR_ACTIVATION')
      }
      contract.depositId = depositAgreement._id.toHexString()
      contract.depositHash = depositAgreement.depositHash
      if (depositAgreement.paidAt) {
        contract.depositPaidAt = depositAgreement.paidAt
      }
      if (depositAgreement.status === 'paid') {
        depositAgreement.status = 'applied-to-lease-security'
        depositAgreement.linkedLeaseContractId = contract._id.toHexString()
        await this.depositAgreementRepository.save(depositAgreement)
      }
    } else {
      contract.depositHash = null
    }

    contract.status = 'active'
    contract.ledgerStatus = 'pending'
    contract.activationFailure = null
    const canonicalReference = requireCanonicalArtifactReference(contract)
    const canonicalHash = canonicalReference.artifactHash
    const tenantSignature = contract.tenantSignature
    const landlordSignature = contract.landlordSignature
    if (!tenantSignature || !landlordSignature) {
      throw new ConflictException('SMARTCA_SIGNATURES_REQUIRED')
    }
    const governanceReference = await this.bindGovernanceSnapshot(contract)
    const ledgerEvidenceInput = {
      contractId: contract._id.toHexString(),
      artifact: {
        artifactId: canonicalReference.artifactId,
        revision: canonicalReference.revision,
        artifactHash: canonicalReference.artifactHash,
        contentType: canonicalReference.contentType,
      },
      signatures: {
        tenant: {
          providerTransactionId: tenantSignature.providerTransactionId ?? '',
          certificateSerial: tenantSignature.certificateSerial ?? '',
          certificateSubject: tenantSignature.certificateSubject ?? null,
          certificateIssuer: tenantSignature.certificateIssuer ?? null,
          signatureHash: tenantSignature.signatureHash ?? null,
          signatureAlgorithm: tenantSignature.signatureAlgorithm ?? null,
          signatureValueRef: tenantSignature.signatureValueRef ?? null,
        },
        landlord: {
          providerTransactionId: landlordSignature.providerTransactionId ?? '',
          certificateSerial: landlordSignature.certificateSerial ?? '',
          certificateSubject: landlordSignature.certificateSubject ?? null,
          certificateIssuer: landlordSignature.certificateIssuer ?? null,
          signatureHash: landlordSignature.signatureHash ?? null,
          signatureAlgorithm: landlordSignature.signatureAlgorithm ?? null,
          signatureValueRef: landlordSignature.signatureValueRef ?? null,
        },
      },
      depositId: contract.depositId ?? null,
      depositHash: contract.depositHash ?? null,
    }
    // Có governance → evidence v3 (chaincode kiểm GOVERNANCE_<snapshotId>); không có → v2 như cũ.
    const ledgerEvidence = governanceReference
      ? buildSignedContractLedgerEvidenceV3({
          ...ledgerEvidenceInput,
          governance: governanceReference,
        })
      : buildSignedContractLedgerEvidence(ledgerEvidenceInput)
    const ledgerEvidenceHash = hashSignedContractLedgerEvidence(ledgerEvidence)
    contract.contractHash = canonicalHash
    contract.activationKey = `smartca:${canonicalHash}`

    if (contract.rentalApplicationId && ObjectId.isValid(contract.propertyId)) {
      const apartment = await this.apartmentRepository.findOne({
        where: { _id: new ObjectId(contract.propertyId) },
      })
      const reservation = apartment?.rentalReservation
      if (
        apartment &&
        reservation?.applicationId === contract.rentalApplicationId
      ) {
        reservation.contractId = contract._id.toHexString()
        reservation.leaseActivatedAt = new Date()
        await this.apartmentRepository.save(apartment)
      }
    }

    const createContractPayload = this.buildCreateContractArgs({
      contractId: contract._id.toHexString(),
      contractCode: contract.contractCode,
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
      contractHash: canonicalHash,
      monthlyRent: resolveEffectiveCommercial(contract).monthlyRent.toString(),
      startDate: contract.startDate.toISOString(),
      depositId: contract.depositId,
      depositHash: contract.depositHash,
      evidenceJson: JSON.stringify(ledgerEvidence),
      requireAbiV2: Boolean(governanceReference),
    })
    const depositDependencyKey = contract.depositId
      ? `deposit:${contract.depositId}:deposit.paid`
      : null
    await this.ledgerOutboxService.enqueue({
      aggregateType: 'contract',
      aggregateId: contract._id.toHexString(),
      eventType: 'contract.activated',
      action: 'createContract',
      args: createContractPayload.args,
      ...(governanceReference
        ? {
            // D12: mọi parent phải confirmed — deposit (nếu có) và governance snapshot.
            dependencyKeys: [
              ...(depositDependencyKey ? [depositDependencyKey] : []),
              `governance-snapshot:${governanceReference.snapshotId}:governance.published`,
            ],
          }
        : { dependencyKey: depositDependencyKey }),
      metadata: {
        contractId: contract._id.toHexString(),
        argsVersion: createContractPayload.argsVersion,
        ...(governanceReference
          ? {
              // Chờ chaincode hỗ trợ ABI v2 + evidence v3 thay vì submit làm rơi governance.
              minimumAbiVersion: 2,
              minimumEvidenceSchemaVersion: 3,
              waitingCode: 'CHAINCODE_UPGRADE_REQUIRED',
            }
          : {}),
        details: {
          contractHash: contract.contractHash,
          artifactHash: canonicalReference.artifactHash,
          artifactId: contract.artifactRef?.artifactId ?? null,
          artifactRevision: canonicalReference.revision,
          evidenceSchemaVersion: ledgerEvidence.schemaVersion,
          evidenceEnvelopeHash: ledgerEvidenceHash,
          evidenceEnvelope: ledgerEvidence,
        },
      },
    })

    const saved = await this.contractRepository.save(contract)
    await this.recordTransactionEvent({
      contractId: saved._id.toHexString(),
      applicationId: saved.rentalApplicationId ?? null,
      eventType: 'contract.activated',
      actorRole: 'system',
      transitionKey: `contract:${saved._id.toHexString()}:activated`,
    })
    if (this.paymentsService) await this.paymentsService.generateSchedule(saved)
    if (this.paymentsService)
      await this.paymentsService.generatePlatformFeeInvoices(saved)
    await this.moveInSettlementsService?.createForContract(saved)
    await this.projectApartmentRental(saved)
    return saved
  }

  async saveContractContent(
    contractId: string,
    actorId: string,
    content: unknown,
    expectedRevision: number,
    isStaff: boolean
  ): Promise<Contract> {
    const contract = await this.findOne(contractId)
    if (!isStaff && contract.landlordId !== actorId) {
      throw new ForbiddenException('CONTRACT_CONTENT_ACCESS_DENIED')
    }
    if (
      ['active', 'terminated', 'completed', 'cancelled'].includes(
        contract.status ?? ''
      )
    ) {
      throw new ConflictException('CONTRACT_CONTENT_STATE_CLOSED')
    }
    if (contract.contentLockedAt || contract.contentLockedHash) {
      throw new BadRequestException('CONTRACT_CONTENT_LOCKED')
    }
    const currentRevision = contract.contentRevision ?? 0
    if (expectedRevision !== currentRevision) {
      throw new ConflictException('CONTRACT_CONTENT_REVISION_STALE')
    }
    const sanitized = sanitizeTipTapContent(content)
    contract.editorContent = sanitized
    contract.contentRevision = currentRevision + 1
    contract.contentLockedHash = null
    contract.contentLockedAt = null
    contract.hashSchemaVersion = 1
    return this.contractRepository.save(contract)
  }

  /**
   * Chốt thông tin hai bên vào hợp đồng ngay trước khi khóa nội dung (họ tên, CCCD, nơi cư trú lấy từ
   * hồ sơ KYC đã duyệt). Chỉ điền chỗ còn trống để không ghi đè dữ liệu staff đã nhập.
   */
  private async snapshotParties(contract: Contract): Promise<void> {
    const [landlordKyc, tenantKyc] = await Promise.all([
      this.kycService.findByUserId(contract.landlordId),
      this.kycService.findByUserId(contract.tenantId),
    ])
    if (landlordKyc?.status === 'verified') {
      contract.landlordName ||= landlordKyc.fullName ?? null
      contract.landlordCccd ||= landlordKyc.idCardNumber ?? null
      contract.landlordAddress ||= landlordKyc.placeOfResidence ?? null
      contract.landlordBirthDate ||= landlordKyc.dateOfBirth ?? null
      contract.landlordIdIssued ||= describeIdIssuance(landlordKyc)
    }
    if (tenantKyc?.status === 'verified') {
      contract.tenantName ||= tenantKyc.fullName ?? null
      contract.tenantCccd ||= tenantKyc.idCardNumber ?? null
      contract.tenantAddress ||= tenantKyc.placeOfResidence ?? null
      contract.tenantBirthDate ||= tenantKyc.dateOfBirth ?? null
      contract.tenantIdIssued ||= describeIdIssuance(tenantKyc)
    }
    // Tài khoản chưa có KYC đã duyệt vẫn có họ tên/điện thoại đăng ký: dùng làm giá trị thay thế
    // để hợp đồng không để trống thông tin các bên (CCCD/địa chỉ vẫn chỉ lấy từ KYC đã duyệt).
    const [landlordUser, tenantUser] = await Promise.all([
      this.findUserContact(contract.landlordId),
      this.findUserContact(contract.tenantId),
    ])
    contract.landlordName ||= landlordUser.fullName
    contract.tenantName ||= tenantUser.fullName
    contract.landlordPhone ||= landlordUser.phone
    contract.tenantPhone ||= tenantUser.phone
    contract.propertyOwnershipCertificate ||=
      await this.findOwnershipCertificate(contract.propertyId)
  }

  private async findUserContact(
    userId: string
  ): Promise<{ fullName: string | null; phone: string | null }> {
    if (!this.userRepository || !ObjectId.isValid(userId)) {
      return { fullName: null, phone: null }
    }
    const user = await this.userRepository.findOne({
      where: { _id: new ObjectId(userId) },
    })
    return {
      fullName: user?.fullName?.trim() || null,
      phone: user?.phone?.trim() || null,
    }
  }

  private async findOwnershipCertificate(
    propertyId: string
  ): Promise<string | null> {
    if (!ObjectId.isValid(propertyId)) return null
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(propertyId) },
    })
    return apartment?.ownershipCertificate?.trim() || null
  }

  async lockContractContent(
    contractId: string,
    actorId: string,
    expectedRevision: number,
    isStaff: boolean
  ): Promise<Contract> {
    const contract = await this.findOne(contractId)
    const isLandlord = contract.landlordId === actorId
    if (!isStaff && !isLandlord) {
      throw new ForbiddenException('CONTRACT_CONTENT_LOCK_ACCESS_DENIED')
    }
    if (contract.contentLockedAt || contract.contentLockedHash) {
      return contract
    }
    const lockGuard = evaluateLockContent({
      contractStatus: contract.status,
      isContentLocked: false,
    })
    if (!lockGuard.enabled) {
      throw new ConflictException('CONTRACT_CONTENT_STATE_CLOSED')
    }
    if ((contract.contentRevision ?? 0) !== expectedRevision) {
      throw new ConflictException('CONTRACT_CONTENT_REVISION_STALE')
    }
    if (contract.editorContent) {
      sanitizeTipTapContent(contract.editorContent)
    }
    const effectiveCommercial =
      contract.commercialDraft ?? resolveEffectiveCommercial(contract)
    contract.effectiveCommercial = { ...effectiveCommercial }
    contract.effectiveCommercialRevision = contract.commercialRevision ?? 0
    const effectiveEndDate = new Date(contract.startDate)
    effectiveEndDate.setMonth(
      effectiveEndDate.getMonth() + effectiveCommercial.durationMonths
    )
    contract.endDate = effectiveEndDate
    const templateRef =
      contract.contractTemplateRef ??
      (contract.termsRef?.key.startsWith('VN_') ? contract.termsRef : undefined)
    const template =
      templateRef && this.templateGovernanceService
        ? await this.templateGovernanceService.getPublishedVersion(
            templateRef.key,
            templateRef.version
          )
        : undefined
    const layoutLegalProfile = template?.legalProfile
    const layout =
      this.layoutService && layoutLegalProfile
        ? await this.layoutService.findPublishedForContract(
            layoutLegalProfile,
            templateRef?.key ?? null
          )
        : null
    if (layout) {
      contract.layoutProfileRef = {
        profileKey: layout.profileKey,
        version: layout.version,
        contentHash: layout.contentHash,
        supplementaryClauses: (layout.supplementaryClauses ?? []).map(
          clause => ({ ...clause })
        ),
      }
    }
    // A layout snapshot opts the contract into the v3 payload. Without a
    // published layout, preserve the v2 canonical-artifact contract path.
    contract.hashSchemaVersion = layout
      ? CONTRACT_CONTENT_HASH_SCHEMA_VERSION
      : 2
    await this.snapshotParties(contract)
    contract.contentLockedHash = hashCanonicalContractPayload(
      buildCanonicalContractPayload(contract, template)
    )
    contract.contentLockedAt = new Date()
    contract.contentRevision = (contract.contentRevision ?? 0) + 1
    contract.status = 'awaiting-signature'
    const locked = await this.contractRepository.save(contract)
    await this.recordTransactionEvent({
      contractId,
      applicationId: locked.rentalApplicationId ?? null,
      eventType: 'contract.content-locked',
      actorRole: isStaff ? 'staff' : 'landlord',
      actorId,
      transitionKey: `contract:${contractId}:content-locked`,
    })
    await this.flowNotificationService?.notifyForContract(contractId)
    return locked
  }

  async reconcileFlowProfile(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    targetFlowProfileRef: { profileId: string; version: number; hash: string }
  ): Promise<Contract> {
    const contract = await this.findOneForUser(contractId, actorId, isStaff)
    if (contract.status !== 'draft') {
      throw new ConflictException('ONLY_DRAFT_CONTRACTS_CAN_BE_RECONCILED')
    }
    if (contract.signedByTenant || contract.signedByLandlord) {
      throw new ConflictException(
        'PARTIALLY_OR_FULLY_SIGNED_CONTRACTS_CANNOT_BE_RECONCILED'
      )
    }
    if (contract.contentLockedAt || contract.contentLockedHash) {
      throw new ConflictException(
        'LOCKED_CONTRACT_CONTENT_CANNOT_BE_RECONCILED'
      )
    }

    contract.flowProfileRef = targetFlowProfileRef
    contract.configStatus = 'CURRENT'
    contract.contentRevision = (contract.contentRevision ?? 0) + 1
    return this.contractRepository.save(contract)
  }

  async terminateContract(
    contractId: string,
    actorId: string,
    reasonCode: string,
    reason: string,
    idempotencyKey: string
  ): Promise<Contract> {
    const contract = await this.findOne(contractId)
    const normalizedKey = idempotencyKey.trim()
    const normalizedReasonCode = reasonCode.trim().toUpperCase()
    const normalizedReason = reason.trim()

    if (!normalizedKey || !normalizedReasonCode || !normalizedReason) {
      throw new BadRequestException('TERMINATION_FIELDS_REQUIRED')
    }

    if (contract.status === 'terminated') {
      if (contract.terminationIdempotencyKey !== normalizedKey) {
        throw new ConflictException('CONTRACT_ALREADY_TERMINATED')
      }
      await this.enqueueTerminationLedgerEvent(contract, actorId)
      return contract
    }
    if (contract.status !== 'active') {
      throw new ConflictException('CONTRACT_TERMINATION_REQUIRES_ACTIVE')
    }

    if (!ObjectId.isValid(contract.propertyId)) {
      throw new BadRequestException('CONTRACT_PROPERTY_ID_INVALID')
    }
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(contract.propertyId) },
    })
    if (!apartment) {
      throw new NotFoundException('CONTRACT_PROPERTY_NOT_FOUND')
    }

    const terminatedAt = new Date()
    const reasonHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          reasonCode: normalizedReasonCode,
          reason: normalizedReason,
        })
      )
      .digest('hex')

    contract.status = 'terminated'
    contract.terminatedAt = terminatedAt
    contract.terminationReason = normalizedReason
    contract.terminationReasonCode = normalizedReasonCode
    contract.terminationIdempotencyKey = normalizedKey
    contract.terminatedBy = actorId
    contract.terminationTxHash = null

    apartment.status = 'available'
    apartment.isVerified = true
    if (
      apartment.rentalReservation?.applicationId ===
      contract.rentalApplicationId
    ) {
      apartment.rentalReservation = null
    }
    await this.contractRepository.save(contract)
    await this.apartmentRepository.save(apartment)
    await this.enqueueTerminationLedgerEvent(contract, actorId, {
      reasonCode: normalizedReasonCode,
      reasonHash,
      terminatedAt,
    })
    return contract
  }

  private async enqueueTerminationLedgerEvent(
    contract: Contract,
    actorId: string,
    payload?: { reasonCode: string; reasonHash: string; terminatedAt: Date }
  ): Promise<void> {
    const reasonCode = payload?.reasonCode ?? contract.terminationReasonCode
    const reasonHash =
      payload?.reasonHash ??
      (contract.terminationReasonCode && contract.terminationReason
        ? crypto
            .createHash('sha256')
            .update(
              JSON.stringify({
                reasonCode: contract.terminationReasonCode,
                reason: contract.terminationReason,
              })
            )
            .digest('hex')
        : null)
    const terminatedAt = payload?.terminatedAt ?? contract.terminatedAt
    if (!reasonCode || !reasonHash || !terminatedAt) {
      throw new BadRequestException('TERMINATION_LEDGER_PAYLOAD_INVALID')
    }

    await this.ledgerOutboxService.enqueue({
      aggregateType: 'contract',
      aggregateId: contract._id.toHexString(),
      eventType: 'contract.terminated',
      action: 'terminateContract',
      args: [
        contract._id.toHexString(),
        reasonCode,
        reasonHash,
        terminatedAt.toISOString(),
      ],
      metadata: {
        contractId: contract._id.toHexString(),
        details: {
          actorId,
          terminationIdempotencyKey: contract.terminationIdempotencyKey,
        },
      },
    })
  }

  async issueSigningGrant(
    contractId: string,
    userId: string,
    biometricGrantId: string,
    otpSessionId: string
  ): Promise<{ grantId: string; expiresAt: Date }> {
    const contract = await this.findOne(contractId)
    const role =
      contract.tenantId === userId
        ? 'tenant'
        : contract.landlordId === userId
          ? 'landlord'
          : null
    if (!role) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (!contract.contentLockedHash) {
      throw new BadRequestException('CONTRACT_CONTENT_NOT_LOCKED')
    }

    if (this.biometricEvidenceService) {
      const bioResult = await this.biometricEvidenceService.consumeEvidence(
        biometricGrantId,
        {
          userId,
          role,
          contractId,
          contentLockedHash: contract.contentLockedHash,
        }
      )
      if (!bioResult.valid) {
        throw new BadRequestException(
          bioResult.message || 'BIOMETRIC_EVIDENCE_INVALID'
        )
      }
    }

    if (this.smartOtpService) {
      const otpResult = await this.smartOtpService.consumeContractOtp(
        otpSessionId,
        userId,
        contractId,
        role,
        contract.contentLockedHash
      )
      if (!otpResult.valid) {
        throw new BadRequestException(
          otpResult.message || 'OTP_SESSION_INVALID'
        )
      }
    }

    const created = createSigningGrant(
      {
        userId,
        role,
        contractId,
        contentLockedHash: contract.contentLockedHash,
        biometricGrantId,
        otpSessionId,
      },
      new Date(),
      5 * 60 * 1000
    )
    const record = this.signingGrantRepository.create({
      ...created.record,
      tokenHash: created.record.tokenHash,
    })
    await this.signingGrantRepository.save(record)
    return { grantId: created.grantId, expiresAt: created.record.expiresAt }
  }

  async verifySignerForUser(
    contractId: string,
    userId: string,
    selfie: Express.Multer.File
  ): Promise<{
    verified: boolean
    faceMatch: boolean
    liveness: boolean
    spoofScore: number | null
    biometricEvidenceId?: string
  }> {
    const contract = await this.findOne(contractId)
    const role =
      contract.tenantId === userId
        ? 'tenant'
        : contract.landlordId === userId
          ? 'landlord'
          : null
    if (!role) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    const result = await this.verifySigner(contractId, role, selfie)
    if (result.verified && this.biometricEvidenceService) {
      const evidence = await this.biometricEvidenceService.issueEvidence({
        userId,
        contractId,
        role,
        contentLockedHash: contract.contentLockedHash ?? '',
      })
      return {
        ...result,
        biometricEvidenceId: evidence.evidenceId,
      }
    }
    return result
  }

  async signContract(
    contractId: string,
    role: 'tenant' | 'landlord'
  ): Promise<Contract> {
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng')
    }
    if (
      !['awaiting-signature', 'fully-signed-pending-deposit'].includes(
        contract.status ?? ''
      )
    ) {
      throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký')
    }

    // Bước 1: Xác minh KYC của người ký trước khi chấp nhận chữ ký
    if (
      contract.executionMethod === 'SMARTCA' &&
      process.env.NODE_ENV === 'production'
    ) {
      throw new ConflictException('SMARTCA_SIGNATURE_REQUIRED')
    }

    const executionStrategy =
      contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST'
    if (
      contract.deposit > 0 &&
      !isDepositGateOpen(
        executionStrategy,
        await this.isDepositConfirmed(contract)
      )
    ) {
      throw new BadRequestException(
        'EXECUTION_POLICY_DEPOSIT_REQUIRED_BEFORE_SIGNING: Hợp đồng yêu cầu tiền cọc đã thanh toán trước khi có hiệu lực'
      )
    }

    const userId = role === 'tenant' ? contract.tenantId : contract.landlordId

    if (process.env.NODE_ENV === 'production') {
      const kyc = await this.kycService.findByUserId(userId)
      if (!kyc || kyc.status !== 'verified') {
        throw new BadRequestException(
          `Người ký (${role}) chưa hoàn tất xác minh KYC hoặc hồ sơ chưa được phê duyệt`
        )
      }
    }

    // Bước 2: Cập nhật chữ ký
    if (role === 'tenant') contract.signedByTenant = true
    if (role === 'landlord') contract.signedByLandlord = true

    // Bước 3: Nếu cả hai đã ký → kích hoạt hợp đồng & neo hash lên blockchain
    if (contract.signedByTenant && contract.signedByLandlord) {
      let depositIdToUse: string | null = null
      let depositHashToUse: string | null = null
      let dependencyKey: string | null = null

      if (contract.deposit && contract.deposit > 0) {
        let depositAgreement: DepositAgreement | null = null
        if (
          contract.depositAgreementId &&
          ObjectId.isValid(contract.depositAgreementId)
        ) {
          depositAgreement = await this.depositAgreementRepository.findOne({
            where: { _id: new ObjectId(contract.depositAgreementId) },
          })
        }
        if (!depositAgreement && contract.rentalApplicationId) {
          depositAgreement = await this.depositAgreementRepository.findOne({
            where: { applicationId: contract.rentalApplicationId },
          })
        }

        if (
          !depositAgreement ||
          (depositAgreement.status !== 'paid' &&
            depositAgreement.status !== 'applied-to-lease-security')
        ) {
          if (executionStrategy === 'SIGN_FIRST') {
            contract.status = 'fully-signed-pending-deposit'
            return this.contractRepository.save(contract)
          }
          throw new BadRequestException(
            'Hợp đồng yêu cầu tiền cọc đã thanh toán trước khi có hiệu lực'
          )
        }

        if (!depositAgreement.depositHash) {
          throw new BadRequestException(
            'Biên lai tiền cọc chưa có mã băm hợp lệ'
          )
        }

        depositIdToUse = depositAgreement._id.toString()
        depositHashToUse = depositAgreement.depositHash
        dependencyKey = `deposit:${depositIdToUse}:deposit.paid`

        contract.depositId = depositIdToUse
        contract.depositHash = depositHashToUse

        if (depositAgreement.status === 'paid') {
          depositAgreement.status = 'applied-to-lease-security'
          depositAgreement.linkedLeaseContractId = contractId
          await this.depositAgreementRepository.save(depositAgreement)
        }
      } else {
        contract.depositHash = null
      }

      contract.status = 'active'
      contract.ledgerStatus = 'pending'
      contract.activationFailure = null

      if (
        contract.rentalApplicationId &&
        ObjectId.isValid(contract.propertyId)
      ) {
        const apartment = await this.apartmentRepository.findOne({
          where: { _id: new ObjectId(contract.propertyId) },
        })
        const reservation = apartment?.rentalReservation
        if (
          apartment &&
          reservation?.applicationId === contract.rentalApplicationId
        ) {
          reservation.contractId = contractId
          reservation.leaseActivatedAt = new Date()
          await this.apartmentRepository.save(apartment)
        }
      }

      // Snapshot toàn bộ chính sách pháp luật tại thời điểm ký
      const allPolicies = await this.policiesService.findAll()
      const snapshot: Record<string, string> = {}
      for (const p of allPolicies) {
        if (p.status === 'active') {
          snapshot[p.key] = p.value
        }
      }
      contract.appliedPolicies = snapshot

      // Tạo mã băm SHA-256 bất biến của nội dung hợp đồng (PII + điều khoản + chính sách pháp luật áp dụng)
      contract.contractHash = this.buildContractHash(contract, snapshot)

      // Đẩy hash lên Hyperledger Fabric
      const createContractPayload = this.buildCreateContractArgs({
        contractId,
        contractCode: contract.contractCode,
        tenantId: contract.tenantId,
        landlordId: contract.landlordId,
        contractHash: contract.contractHash,
        monthlyRent:
          resolveEffectiveCommercial(contract).monthlyRent.toString(),
        startDate: contract.startDate.toISOString(),
        depositId: depositIdToUse,
        depositHash: depositHashToUse,
      })

      await this.ledgerOutboxService.enqueue({
        aggregateType: 'contract',
        aggregateId: contractId,
        eventType: 'contract.activated',
        action: 'createContract',
        args: createContractPayload.args,
        dependencyKey,
        metadata: {
          contractId,
          argsVersion: createContractPayload.argsVersion,
          details: { contractHash: contract.contractHash },
        },
      })
      contract.blockchainAddress = null
      this.logger.log(
        `Contract ${contract.contractCode} activated; ledger synchronization queued`
      )
    }

    const saved = await this.contractRepository.save(contract)

    if (saved.status === 'active') {
      await this.recordTransactionEvent({
        contractId: saved._id.toHexString(),
        applicationId: saved.rentalApplicationId ?? null,
        eventType: 'contract.activated',
        actorRole: 'system',
        transitionKey: `contract:${saved._id.toHexString()}:activated`,
      })
    }

    if (saved.status === 'active' && this.paymentsService) {
      await this.paymentsService.generateSchedule(saved)
      await this.paymentsService.generatePlatformFeeInvoices(saved)
    }
    if (saved.status === 'active') {
      await this.moveInSettlementsService?.createForContract(saved)
      await this.projectApartmentRental(saved)
    }
    return saved
  }

  // ── Lấy chi tiết hợp đồng ──

  async activateAfterDeposit(contractId: string): Promise<Contract> {
    const contract = await this.findOne(contractId)
    if (
      contract.status !== 'fully-signed-pending-deposit' ||
      !contract.signedByTenant ||
      !contract.signedByLandlord
    ) {
      return contract
    }
    if (
      contract.executionMethod === 'SMARTCA' &&
      contract.tenantSignature?.provider === 'smartca' &&
      contract.landlordSignature?.provider === 'smartca'
    ) {
      return this.activateSmartCaContract(contract)
    }
    return this.signContract(contractId, 'tenant')
  }

  /**
   * Cổng khôi phục cho `RETRY_ACTIVATION`: đi qua cùng kiểm tra nghiệp vụ như
   * luồng thường (`activateAfterDeposit`) thay vì tự kiểm tra một cách rời
   * rạc. Khác với `activateAfterDeposit` (được gọi đầu cơ từ callback thanh
   * toán và phải im lặng khi chưa đủ điều kiện), hành động khôi phục do staff
   * chủ động gọi nên phải từ chối rõ ràng khi cổng kích hoạt chưa sẵn sàng.
   */
  async retryActivation(contractId: string): Promise<Contract> {
    const contract = await this.findOne(contractId)
    if (
      contract.status !== 'fully-signed-pending-deposit' ||
      !contract.signedByTenant ||
      !contract.signedByLandlord
    ) {
      throw new ConflictException('ACTIVATION_NOT_READY')
    }
    return this.activateAfterDeposit(contractId)
  }

  async activatePendingForDepositAgreement(
    depositAgreementId: string
  ): Promise<Contract | null> {
    const contract = await this.contractRepository.findOne({
      where: { depositAgreementId },
    })
    if (!contract) return null
    return this.activateAfterDeposit(contract._id.toHexString())
  }

  /**
   * Nguồn sự thật duy nhất cho "cọc đã xác nhận chưa" của một hợp đồng.
   * Dùng chung logic với SmartCaSigningService (qua
   * DepositConfirmationResolver) và ContractViewService để tránh ba nơi
   * suy luận khác nhau. Public vì các consumer khác trong module (ví dụ
   * SmartCaSigningService qua optional contractsService reference) có thể
   * cần tái sử dụng.
   */
  async isDepositConfirmed(contract: Contract): Promise<boolean> {
    const agreement = await this.findDepositAgreementForContract(contract)
    return resolveDepositConfirmation(
      {
        deposit: contract.deposit,
        depositPaidAt: contract.depositPaidAt ?? null,
      },
      agreement
        ? {
            id: agreement._id.toHexString(),
            status: agreement.status,
            amount: agreement.amount,
            paidAt: agreement.paidAt ?? null,
          }
        : null
    ).confirmed
  }

  private async findDepositAgreementForContract(
    contract: Contract
  ): Promise<DepositAgreement | null> {
    let agreement: DepositAgreement | null = null
    if (
      contract.depositAgreementId &&
      ObjectId.isValid(contract.depositAgreementId)
    ) {
      agreement = await this.depositAgreementRepository.findOne({
        where: { _id: new ObjectId(contract.depositAgreementId) },
      })
    }
    if (!agreement && contract.rentalApplicationId) {
      agreement = await this.depositAgreementRepository.findOne({
        where: { applicationId: contract.rentalApplicationId },
      })
    }
    return agreement
  }

  async findOne(contractId: string): Promise<Contract> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng')
    }
    return contract
  }

  async findOneForUser(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Contract> {
    const contract = await this.findOne(contractId)
    if (
      !isStaff &&
      contract.tenantId !== actorId &&
      contract.landlordId !== actorId
    ) {
      throw new ForbiddenException('CONTRACT_ACCESS_DENIED')
    }
    return contract
  }

  async getPublicServiceChecklistForUser(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    purpose: unknown
  ): Promise<PublicServiceChecklist> {
    try {
      parsePublicServiceChecklistPurpose(purpose)
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : 'PUBLIC_SERVICE_PURPOSE_UNSUPPORTED'
      throw new BadRequestException(code)
    }

    const contract = await this.findOneForUser(contractId, actorId, isStaff)
    return buildPublicServiceChecklist(contract)
  }

  // ── Lấy danh sách hợp đồng theo người dùng ──

  async findByUser(userId: string): Promise<Contract[]> {
    const [asLandlord, asTenant] = await Promise.all([
      this.contractRepository.find({
        where: { landlordId: userId },
        order: { createdAt: 'DESC' },
      }),
      this.contractRepository.find({
        where: { tenantId: userId },
        order: { createdAt: 'DESC' },
      }),
    ])

    // Gộp và loại bỏ trùng lặp (một user có thể vừa là chủ nhà vừa là khách thuê)
    const map = new Map<string, Contract>()
    for (const c of [...asLandlord, ...asTenant]) {
      map.set(c._id.toHexString(), c)
    }
    return Array.from(map.values())
  }

  // ── Xác minh tính toàn vẹn hợp đồng — so sánh với Hyperledger Fabric ──

  /**
   * Xác minh tính toàn vẹn hợp đồng qua 4 trạng thái trung thực:
   * 'valid' | 'invalid' | 'not-recorded' | 'unavailable'
   */
  async verifyIntegrity(contractId: string): Promise<{
    isValid: boolean | null
    verificationStatus: 'valid' | 'invalid' | 'not-recorded' | 'unavailable'
    currentHash: string
    storedHash: string | null
    blockchainAddress: string | null
    onChain: ChainVerifyResult | null
    semanticHash: string | null
    artifactHash: string | null
    layers: {
      offChain: IntegrityLayer
      artifact: IntegrityLayer
      onChain: IntegrityLayer
    }
    signatureIntegrity: 'valid' | 'invalid' | 'not-available'
    amendmentChainIntegrity: 'valid' | 'invalid' | 'not-available'
  }> {
    const contract = await this.findOne(contractId)

    // Lớp 1: Tính lại hash từ dữ liệu MongoDB
    const currentHash = this.buildContractHash(
      contract,
      contract.appliedPolicies ?? {}
    )
    const mongoMatch = currentHash === contract.contractHash

    const offChainLayer: IntegrityLayer = {
      status: mongoMatch ? 'valid' : 'mismatch',
      hash: contract.contractHash ?? null,
    }
    let artifactLayer: IntegrityLayer = {
      status: contract.artifactRef ? 'unavailable' : 'not-recorded',
      hash: contract.artifactRef?.artifactHash ?? null,
    }
    if (contract.artifactRef && this.artifactService) {
      try {
        const resolved =
          await this.artifactService.resolveCanonicalArtifact(contract)
        artifactLayer = {
          status: 'valid',
          hash: resolved.artifact.artifactHash,
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        artifactLayer = {
          status: reason.includes('HASH_MISMATCH') ? 'mismatch' : 'unavailable',
          hash: contract.artifactRef.artifactHash,
          reason,
        }
      }
    }

    let onChain: ChainVerifyResult | null = null
    let verificationStatus:
      | 'valid'
      | 'invalid'
      | 'not-recorded'
      | 'unavailable' = 'not-recorded'
    let isValid: boolean | null = null
    let onChainLayer: IntegrityLayer = {
      status:
        !contract.blockchainAddress || contract.ledgerStatus !== 'confirmed'
          ? 'not-recorded'
          : mongoMatch
            ? 'unavailable'
            : 'mismatch',
      hash: null,
    }

    if (!mongoMatch) {
      verificationStatus = 'invalid'
      isValid = false
    } else if (
      !contract.blockchainAddress ||
      contract.ledgerStatus !== 'confirmed'
    ) {
      verificationStatus = 'not-recorded'
      isValid = null
    } else {
      try {
        const raw = await this.fabricService.evaluateTransaction(
          'verifyContract',
          [contractId, currentHash]
        )
        onChain = (
          typeof raw === 'string' ? JSON.parse(raw) : raw
        ) as ChainVerifyResult

        if (onChain && onChain.valid === true) {
          verificationStatus = 'valid'
          isValid = true
          onChainLayer = {
            status: 'valid',
            hash: onChain.onChainHash ?? currentHash,
          }
        } else {
          verificationStatus = 'invalid'
          isValid = false
          onChainLayer = {
            status: 'mismatch',
            hash: onChain?.onChainHash ?? null,
            reason: onChain?.reason ?? 'HASH_MISMATCH',
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Không thể truy vấn Fabric để xác minh hợp đồng ${contractId}: ${errMsg}`
        )
        verificationStatus = 'unavailable'
        isValid = null
        onChainLayer = { status: 'unavailable', hash: null, reason: errMsg }
      }
    }

    if (artifactLayer.status === 'mismatch') {
      verificationStatus = 'invalid'
      isValid = false
    } else if (artifactLayer.status === 'unavailable' && isValid === true) {
      verificationStatus = 'unavailable'
      isValid = null
    }

    let amendmentChainIntegrity: 'valid' | 'invalid' | 'not-available' =
      'not-available'
    if (this.amendmentRepository) {
      const amendments = await this.amendmentRepository.find({
        where: { contractId },
        order: { sequence: 'ASC' },
      })
      amendmentChainIntegrity = amendments.every((amendment, index) => {
        const previous = amendments[index - 1]
        const sequenceValid = amendment.sequence === index + 1
        const signatureValid =
          amendment.status !== 'effective' ||
          (Boolean(amendment.tenantSignature) &&
            Boolean(amendment.landlordSignature) &&
            amendment.tenantSignature?.artifactHash ===
              amendment.artifactHash &&
            amendment.landlordSignature?.artifactHash ===
              amendment.artifactHash)
        const predecessorValid =
          index === 0 || amendment.predecessorId === previous?._id.toHexString()
        return sequenceValid && signatureValid && predecessorValid
      })
        ? 'valid'
        : 'invalid'
    }

    return {
      isValid,
      verificationStatus,
      currentHash,
      storedHash: contract.contractHash,
      blockchainAddress: contract.blockchainAddress,
      onChain,
      semanticHash: contract.contentLockedHash ?? null,
      artifactHash: contract.artifactRef?.artifactHash ?? null,
      layers: {
        offChain: offChainLayer,
        artifact: artifactLayer,
        onChain: onChainLayer,
      },
      signatureIntegrity:
        contract.tenantSignature && contract.landlordSignature
          ? contract.tenantSignature.artifactHash ===
              contract.artifactRef?.artifactHash &&
            contract.landlordSignature.artifactHash ===
              contract.artifactRef?.artifactHash
            ? 'valid'
            : 'invalid'
          : 'not-available',
      amendmentChainIntegrity,
    }
  }

  async verifyIntegrityForUser(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Awaited<ReturnType<ContractsService['verifyIntegrity']>>> {
    await this.findOneForUser(contractId, actorId, isStaff)
    return this.verifyIntegrity(contractId)
  }

  // ── Xác thực khuôn mặt người ký hợp đồng ──

  async verifySigner(
    contractId: string,
    role: 'tenant' | 'landlord',
    selfie: Express.Multer.File
  ): Promise<{
    verified: boolean
    faceMatch: boolean
    liveness: boolean
    spoofScore: number | null
  }> {
    this.logger.log(
      `Verifying signer identity for contract ${contractId}, role: ${role}`
    )

    let userId: string
    try {
      const contract = await this.findOne(contractId)
      userId = role === 'tenant' ? contract.tenantId : contract.landlordId
    } catch {
      this.logger.warn(
        `Contract ${contractId} not found. Falling back to contractId as userId.`
      )
      userId = contractId
    }

    if (!userId || !ObjectId.isValid(userId)) {
      throw new BadRequestException(
        `Hợp đồng thiếu thông tin ID hoặc ID không hợp lệ cho ${role}`
      )
    }

    const kycRecord = await this.kycService.findByUserId(userId)
    if (!kycRecord || kycRecord.status !== 'verified') {
      throw new BadRequestException(
        `Người ký (${role}) chưa hoàn tất xác minh KYC hoặc trạng thái không hợp lệ`
      )
    }

    if (!kycRecord.frontCardUrl) {
      throw new BadRequestException(
        'Hồ sơ KYC thiếu ảnh mặt trước CCCD để đối sánh'
      )
    }

    const frontCard = await this.kycMediaService.asMulterFile(
      kycRecord.frontCardUrl,
      'frontID'
    )
    const verificationResult = await this.ekycProxyService.verifyFace(
      selfie,
      frontCard
    )

    return {
      verified: verificationResult.verified,
      faceMatch: verificationResult.faceMatch,
      liveness: verificationResult.liveness,
      spoofScore: verificationResult.realConfidence,
    }
  }

  private async resolveCanonicalTemplateRef(): Promise<NonNullable<
    Contract['contractTemplateRef']
  > | null> {
    if (!this.templateGovernanceService) return null
    try {
      const template = await this.templateGovernanceService.getPublishedVersion(
        'VN_INDIVIDUAL_RESIDENTIAL_LEASE'
      )
      return {
        key: template.templateKey,
        version: template.version,
        contentHash: template.contentHash,
        schemaVersion: template.schemaVersion,
        legalProfile: template.legalProfile,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Canonical lease template unavailable during provisioning: ${message}`
      )
      return null
    }
  }
}
