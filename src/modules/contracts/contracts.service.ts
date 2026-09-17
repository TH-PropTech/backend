import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import * as crypto from 'crypto'
import { Contract } from './schemas/contract.schema'
import { SigningGrant } from './schemas/signing-grant.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import {
  consumeSigningGrant,
  createSigningGrant,
  hashGrantId,
} from './signing-grant.util'
import { PoliciesService } from '../policies/policies.service'
import { FabricService } from '../fabric/fabric.service'
import { KycService } from '../kyc/kyc.service'
import { EkycProxyService } from '../kyc/ekyc-proxy.service'
import { KycMediaService } from '../kyc/kyc-media.service'
import {
  canonicalizeTipTapContent,
  sanitizeTipTapContent,
} from './legal/tiptap-content'
import {
  buildPublicServiceChecklist,
  parsePublicServiceChecklistPurpose,
  type PublicServiceChecklist,
} from './legal/public-service-checklist'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { LedgerOutboxService } from '../fabric/ledger-outbox.service'
import { PaymentsService } from '../payments/payments.service'
import type { RentalPackageSnapshot } from '../apartments/rental-package.util'
import { BiometricEvidenceService } from '../kyc/biometric-evidence.service'
import { SmartOtpService } from '../smart-otp/services/smart-otp.service'

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

// ── Service ──

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name)

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SigningGrant)
    private readonly signingGrantRepository: Repository<SigningGrant>,
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
    @Optional() private readonly smartOtpService?: SmartOtpService
  ) {}

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
    contract.applicationReviewHash = input.applicationReviewHash ?? null
    contract.termsRef = input.termsRef ?? null
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
    return this.signContract(contractId, role)
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

  async lockContractContent(
    contractId: string,
    actorId: string,
    expectedRevision: number,
    isStaff: boolean
  ): Promise<Contract> {
    if (!isStaff)
      throw new ForbiddenException('CONTRACT_CONTENT_LOCK_ACCESS_DENIED')
    const contract = await this.findOne(contractId)
    if (contract.contentLockedAt || contract.contentLockedHash) {
      return contract
    }
    if (
      ['active', 'terminated', 'completed', 'cancelled'].includes(
        contract.status ?? ''
      )
    ) {
      throw new ConflictException('CONTRACT_CONTENT_STATE_CLOSED')
    }
    if ((contract.contentRevision ?? 0) !== expectedRevision) {
      throw new ConflictException('CONTRACT_CONTENT_REVISION_STALE')
    }
    if (!contract.editorContent) {
      throw new BadRequestException('CONTRACT_CONTENT_REQUIRED')
    }
    sanitizeTipTapContent(contract.editorContent)
    contract.contentLockedHash = this.buildLockedContentHash(contract)
    contract.contentLockedAt = new Date()
    contract.hashSchemaVersion = 1
    contract.contentRevision = (contract.contentRevision ?? 0) + 1
    contract.status = 'awaiting-signature'
    return this.contractRepository.save(contract)
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
    if (contract.status !== 'awaiting-signature') {
      throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký')
    }

    // Bước 1: Xác minh KYC của người ký trước khi chấp nhận chữ ký
    const userId = role === 'tenant' ? contract.tenantId : contract.landlordId
    const kyc = await this.kycService.findByUserId(userId)
    if (!kyc || kyc.status !== 'verified') {
      throw new BadRequestException(
        `Người ký (${role}) chưa hoàn tất xác minh KYC hoặc hồ sơ chưa được phê duyệt`
      )
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
      const contractArgs = [
        contractId,
        contract.contractCode,
        contract.tenantId,
        contract.landlordId,
        contract.contractHash,
        contract.monthlyRent.toString(),
        contract.startDate.toISOString(),
      ]
      if (depositIdToUse && depositHashToUse) {
        contractArgs.push(depositIdToUse, depositHashToUse)
      }

      await this.ledgerOutboxService.enqueue({
        aggregateType: 'contract',
        aggregateId: contractId,
        eventType: 'contract.activated',
        action: 'createContract',
        args: contractArgs,
        dependencyKey,
        metadata: {
          contractId,
          details: { contractHash: contract.contractHash },
        },
      })
      contract.blockchainAddress = null
      this.logger.log(
        `Contract ${contract.contractCode} activated; ledger synchronization queued`
      )
    }

    const saved = await this.contractRepository.save(contract)

    if (saved.status === 'active' && this.paymentsService) {
      await this.paymentsService.generateSchedule(saved)
    }
    return saved
  }

  // ── Lấy chi tiết hợp đồng ──

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

  private buildLockedContentHash(contract: Contract): string {
    const canonicalPayload = JSON.stringify({
      hashSchemaVersion: 1,
      editorContent: canonicalizeTipTapContent(contract.editorContent),
      packageSnapshot: contract.packageSnapshot ?? null,
      parties: {
        tenantId: contract.tenantId,
        landlordId: contract.landlordId,
      },
      property: {
        propertyId: contract.propertyId,
        propertyTitle: contract.propertyTitle,
        propertyAddress: contract.propertyAddress,
      },
      money: {
        monthlyRent: contract.monthlyRent,
        deposit: contract.deposit,
      },
      dates: {
        startDate: contract.startDate.toISOString(),
        endDate: contract.endDate.toISOString(),
      },
      appliedPolicies: contract.appliedPolicies ?? {},
      applicationReviewHash: contract.applicationReviewHash ?? null,
      termsRef: contract.termsRef ?? null,
    })
    return crypto.createHash('sha256').update(canonicalPayload).digest('hex')
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
  }> {
    const contract = await this.findOne(contractId)

    // Lớp 1: Tính lại hash từ dữ liệu MongoDB
    const currentHash = this.buildContractHash(
      contract,
      contract.appliedPolicies ?? {}
    )
    const mongoMatch = currentHash === contract.contractHash

    let onChain: ChainVerifyResult | null = null
    let verificationStatus:
      | 'valid'
      | 'invalid'
      | 'not-recorded'
      | 'unavailable' = 'not-recorded'
    let isValid: boolean | null = null

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
        } else {
          verificationStatus = 'invalid'
          isValid = false
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        this.logger.warn(
          `Không thể truy vấn Fabric để xác minh hợp đồng ${contractId}: ${errMsg}`
        )
        verificationStatus = 'unavailable'
        isValid = null
      }
    }

    return {
      isValid,
      verificationStatus,
      currentHash,
      storedHash: contract.contractHash,
      blockchainAddress: contract.blockchainAddress,
      onChain,
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
}
