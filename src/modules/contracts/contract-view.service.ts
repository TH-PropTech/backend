import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Contract } from './schemas/contract.schema'
import { DepositAgreement } from './schemas/deposit-agreement.schema'
import { KycService } from '../kyc/kyc.service'
import { LedgerAuditQueryService } from '../fabric/ledger-audit-query.service'
import { FabricService } from '../fabric/fabric.service'
import { ContractDocumentProjector } from './legal/contract-document.projector'
import { OwnershipTransferResolver } from '../property-ownership-transfer/ownership-transfer.resolver'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractTemplateGovernanceService } from './legal/contract-template-governance.service'
import { ContractAmendment } from './schemas/contract-amendment.schema'
import {
  ContractViewDto,
  ContractPartyViewDto,
  ContractDepositViewDto,
  SigningEligibilityDto,
  ContractLedgerSummaryDto,
  ContractExecutionPolicyViewDto,
} from './dto/contract-view.dto'

@Injectable()
export class ContractViewService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(DepositAgreement)
    private readonly depositAgreementRepository: Repository<DepositAgreement>,
    private readonly kycService: KycService,
    private readonly ledgerAuditQueryService: LedgerAuditQueryService,
    @Optional() private readonly fabricService?: FabricService,
    @Optional()
    private readonly ownershipTransferResolver?: OwnershipTransferResolver,
    @Optional() private readonly artifactService?: ContractArtifactService,
    @Optional()
    private readonly templateGovernanceService?: ContractTemplateGovernanceService,
    @Optional()
    @InjectRepository(ContractAmendment)
    private readonly amendmentRepository?: Repository<ContractAmendment>
  ) {}

  /**
   * Lấy read model enriched view của hợp đồng cho một actor cụ thể
   */
  async getForActor(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<ContractViewDto> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }

    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })

    if (!contract) {
      throw new NotFoundException('Không tìm thấy hợp đồng')
    }

    const isTenant = contract.tenantId === actorId
    const isLandlord = contract.landlordId === actorId
    const access = this.ownershipTransferResolver
      ? await this.ownershipTransferResolver.resolveContractAccess(
          actorId,
          contract,
          isStaff
        )
      : {
          canReadWorkspace: isStaff || isTenant || isLandlord,
          canSign: !isStaff && (isTenant || isLandlord),
          isOriginalParticipant: isTenant || isLandlord,
          isSuccessorOwner: false,
        }

    if (!access.canReadWorkspace) {
      throw new ForbiddenException('CONTRACT_ACCESS_DENIED')
    }

    let artifactFailure: 'mismatch' | 'unavailable' | null = null
    let artifactAvailable = false
    if (contract.artifactRef && this.artifactService) {
      try {
        await this.artifactService.resolveCanonicalArtifact(contract)
        artifactAvailable = true
      } catch (error) {
        artifactFailure =
          error instanceof ConflictException ? 'mismatch' : 'unavailable'
      }
    }

    // 1. Chiếu cấu trúc văn bản pháp lý
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
    const document = ContractDocumentProjector.projectDocument(
      contract,
      template
    )
    if (artifactFailure) document.integrity = artifactFailure
    const amendments = this.amendmentRepository
      ? await this.amendmentRepository.find({
          where: { contractId },
          order: { sequence: 'ASC' },
        })
      : []
    const effectiveAmendments = amendments.filter(
      amendment =>
        amendment.status === 'effective' &&
        amendment.effectiveFrom.getTime() <= Date.now()
    )
    const governingAmendment =
      effectiveAmendments[effectiveAmendments.length - 1]
    document.amendmentHistory = amendments.map(amendment => ({
      id: amendment._id.toHexString(),
      sequence: amendment.sequence,
      status:
        amendment.status === 'effective' &&
        amendment.effectiveFrom.getTime() > Date.now()
          ? 'pending-effective'
          : amendment.status,
      effectiveFrom: amendment.effectiveFrom.toISOString(),
      contentHash: amendment.contentHash ?? null,
      artifactHash: amendment.artifactHash ?? null,
      artifactId: amendment.artifactId ?? null,
      artifactIntegrity: amendment.artifactRef ? 'available' : 'missing',
      ledgerStatus: amendment.ledgerStatus ?? 'not-requested',
      ledgerTxHash: amendment.ledgerTxHash ?? null,
      tenantSigned: Boolean(amendment.tenantSignature),
      landlordSigned: Boolean(amendment.landlordSignature),
    }))
    document.governingAmendmentId =
      governingAmendment?._id.toHexString() ?? null

    // 2. Chiếu thông tin 2 bên
    const [tenantKyc, landlordKyc] = await Promise.all([
      contract.tenantId
        ? this.kycService.findByUserId(contract.tenantId)
        : null,
      contract.landlordId
        ? this.kycService.findByUserId(contract.landlordId)
        : null,
    ])

    const maskCccd = (cccd?: string | null): string | null => {
      if (!cccd || cccd.length < 6) return null
      return `${cccd.substring(0, 3)}***${cccd.substring(cccd.length - 3)}`
    }

    const tenantParty: ContractPartyViewDto = {
      id: contract.tenantId,
      name: contract.tenantName || 'Khách thuê',
      role: 'tenant',
      maskedCccd: maskCccd(contract.tenantCccd || tenantKyc?.idCardNumber),
      address: contract.tenantAddress ?? null,
      kycStatus:
        (tenantKyc?.status as
          | 'unverified'
          | 'pending'
          | 'verified'
          | 'rejected') || 'unverified',
      hasSigned: Boolean(contract.signedByTenant),
      signedAt: contract.tenantSignature?.signedAt
        ? new Date(contract.tenantSignature.signedAt).toISOString()
        : null,
      signatureHash: contract.tenantSignature?.contentHash ?? null,
      provider: contract.tenantSignature?.provider ?? null,
      providerTransactionId:
        contract.tenantSignature?.providerTransactionId ?? null,
      certificateSerial: contract.tenantSignature?.certificateSerial ?? null,
      signatureAlgorithm: contract.tenantSignature?.signatureAlgorithm ?? null,
      signatureValueRef: contract.tenantSignature?.signatureValueRef ?? null,
      providerStatus: contract.tenantSignature?.providerStatus ?? null,
      verifiedAt: contract.tenantSignature?.verifiedAt
        ? new Date(contract.tenantSignature.verifiedAt).toISOString()
        : null,
    }

    const landlordParty: ContractPartyViewDto = {
      id: contract.landlordId,
      name: contract.landlordName || 'Chủ nhà',
      role: 'landlord',
      maskedCccd: maskCccd(contract.landlordCccd || landlordKyc?.idCardNumber),
      address: contract.landlordAddress ?? null,
      kycStatus:
        (landlordKyc?.status as
          | 'unverified'
          | 'pending'
          | 'verified'
          | 'rejected') || 'unverified',
      hasSigned: Boolean(contract.signedByLandlord),
      signedAt: contract.landlordSignature?.signedAt
        ? new Date(contract.landlordSignature.signedAt).toISOString()
        : null,
      signatureHash: contract.landlordSignature?.contentHash ?? null,
      provider: contract.landlordSignature?.provider ?? null,
      providerTransactionId:
        contract.landlordSignature?.providerTransactionId ?? null,
      certificateSerial: contract.landlordSignature?.certificateSerial ?? null,
      signatureAlgorithm:
        contract.landlordSignature?.signatureAlgorithm ?? null,
      signatureValueRef: contract.landlordSignature?.signatureValueRef ?? null,
      providerStatus: contract.landlordSignature?.providerStatus ?? null,
      verifiedAt: contract.landlordSignature?.verifiedAt
        ? new Date(contract.landlordSignature.verifiedAt).toISOString()
        : null,
    }

    // 3. Chiếu thông tin tiền cọc
    let depositDto: ContractDepositViewDto | null = null
    let isDepositPaid = Boolean(contract.depositPaidAt)

    if (
      contract.depositAgreementId &&
      ObjectId.isValid(contract.depositAgreementId)
    ) {
      const depositAgreement = await this.depositAgreementRepository.findOne({
        where: { _id: new ObjectId(contract.depositAgreementId) },
      })
      if (depositAgreement) {
        if (depositAgreement.status === 'paid') isDepositPaid = true
        depositDto = {
          agreementId: depositAgreement._id.toString(),
          agreementCode:
            depositAgreement.agreementCode ||
            contract.depositAgreementCode ||
            null,
          amount: depositAgreement.amount || contract.deposit,
          currency: 'VND',
          status:
            (depositAgreement.status as
              | 'draft'
              | 'pending'
              | 'paid'
              | 'transferred') || 'pending',
          consentGiven: Boolean(depositAgreement.tenantConsent),
          contentRevision: depositAgreement.contentRevision,
          contentHash: depositAgreement.contentHash,
          paidAt: depositAgreement.paidAt
            ? depositAgreement.paidAt.toISOString()
            : null,
          txHash: contract.depositTxHash ?? null,
        }
      }
    }

    if (!depositDto && contract.deposit > 0) {
      depositDto = {
        agreementId: contract.depositAgreementId ?? null,
        agreementCode: contract.depositAgreementCode ?? null,
        amount: contract.deposit,
        currency: 'VND',
        status: isDepositPaid ? 'paid' : 'pending',
        consentGiven: true,
        contentRevision: null,
        contentHash: null,
        paidAt: contract.depositPaidAt
          ? contract.depositPaidAt.toISOString()
          : null,
        txHash: contract.depositTxHash ?? null,
      }
    }

    // 4. Tính toán Signing Eligibility theo ma trận server
    const currentActorRole = isTenant
      ? 'tenant'
      : isLandlord
        ? 'landlord'
        : null
    const currentActorKyc = isTenant
      ? tenantKyc
      : isLandlord
        ? landlordKyc
        : null
    const hasCurrentActorSigned = isTenant
      ? contract.signedByTenant
      : isLandlord
        ? contract.signedByLandlord
        : false

    const executionStrategy =
      contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST'
    const activationReady =
      isDepositPaid && contract.signedByTenant && contract.signedByLandlord
    const executionPolicy: ContractExecutionPolicyViewDto = {
      policyId: contract.executionPolicySnapshot?.policyId ?? 'deposit-first',
      version: contract.executionPolicySnapshot?.version ?? 1,
      strategy: executionStrategy,
      depositConfirmed: isDepositPaid,
      activationReady,
      nextAction: activationReady
        ? null
        : !isDepositPaid && executionStrategy === 'DEPOSIT_FIRST'
          ? 'Xác nhận tiền cọc trước khi ký SmartCA.'
          : !isDepositPaid
            ? 'Hoàn tất tiền cọc để kích hoạt sau khi hai bên ký.'
            : 'Hoàn tất chữ ký SmartCA của cả hai bên.',
    }

    const signingEligibility: SigningEligibilityDto =
      this.deriveSigningEligibility({
        isParticipant: isTenant || isLandlord,
        role: currentActorRole,
        contractStatus: contract.status || 'draft',
        isContentLocked: Boolean(
          contract.contentLockedHash && contract.contentLockedAt
        ),
        isDepositPaid,
        isKycVerified: currentActorKyc?.status === 'verified',
        hasSigned: Boolean(hasCurrentActorSigned),
        isConfigOutdated: contract.configStatus === 'CONFIG_OUTDATED',
        executionStrategy,
      })

    // 5. Chiếu trạng thái Sổ cái Ledger
    const auditEvents =
      await this.ledgerAuditQueryService.getContractEvents(contractId)
    const latestLedgerEvent = auditEvents.find(e => e.category === 'ledger')

    const currentMode: 'simulation' | 'fabric' =
      contract.ledgerNetworkMode === 'fabric' ||
      latestLedgerEvent?.networkMode === 'fabric' ||
      this.fabricService?.getStatus().mode === 'fabric'
        ? 'fabric'
        : 'simulation'

    let ledgerStatus: ContractLedgerSummaryDto['status'] = 'not-requested'

    if (contract.ledgerStatus === 'confirmed') {
      ledgerStatus =
        currentMode === 'simulation'
          ? 'confirmed-simulation'
          : 'confirmed-fabric'
    } else if (contract.ledgerStatus === 'pending') {
      ledgerStatus = 'pending'
    } else if (contract.ledgerStatus === 'processing') {
      ledgerStatus = 'processing'
    } else if (contract.ledgerStatus === 'failed') {
      ledgerStatus = latestLedgerEvent?.retryable
        ? 'failed-retryable'
        : 'failed-terminal'
    } else if (latestLedgerEvent) {
      if (latestLedgerEvent.status === 'pending') ledgerStatus = 'pending'
      else if (latestLedgerEvent.status === 'processing')
        ledgerStatus = 'processing'
      else if (latestLedgerEvent.status === 'confirmed') {
        ledgerStatus =
          currentMode === 'simulation'
            ? 'confirmed-simulation'
            : 'confirmed-fabric'
      } else if (latestLedgerEvent.status === 'failed') {
        ledgerStatus = latestLedgerEvent.retryable
          ? 'failed-retryable'
          : 'failed-terminal'
      }
    } else if (contract.blockchainAddress) {
      ledgerStatus =
        currentMode === 'simulation'
          ? 'confirmed-simulation'
          : 'confirmed-fabric'
    }

    const fabricStatus = this.fabricService?.getStatus()
    const connectionState: 'disabled' | 'connected' | 'unavailable' =
      currentMode === 'simulation'
        ? 'connected'
        : (fabricStatus?.connectionState ?? 'unavailable')

    const ledger: ContractLedgerSummaryDto = {
      networkMode: currentMode,
      connectionState,
      status: ledgerStatus,
      txHash: contract.blockchainAddress || latestLedgerEvent?.txHash || null,
      blockNumber: latestLedgerEvent?.blockNumber ?? null,
      verifiedAt: contract.ledgerRecordedAt
        ? contract.ledgerRecordedAt.toISOString()
        : contract.contentLockedAt
          ? contract.contentLockedAt.toISOString()
          : null,
      onChainValid: null,
    }

    const commercial = contract.effectiveCommercial ??
      contract.commercialDraft ?? {
        monthlyRent: contract.monthlyRent,
        deposit: contract.deposit,
        paymentDay: contract.paymentDay,
        durationMonths: contract.durationMonths ?? null,
        latePenaltyRate: contract.latePenaltyRate || 10,
        terminationNoticeDays: contract.terminationNoticeDays || 30,
      }

    // 6. Hoàn thiện ContractViewDto
    return {
      contract: {
        id: contract._id.toString(),
        code: contract.contractCode,
        status:
          (contract.status as
            | 'draft'
            | 'pending'
            | 'signed'
            | 'active'
            | 'terminated'
            | 'cancelled') || 'draft',
        property: {
          id: contract.propertyId,
          title: contract.propertyTitle,
          address: contract.propertyAddress ?? null,
          area: contract.propertyArea ?? null,
          furniture: contract.propertyFurniture ?? null,
          value: contract.propertyValue || contract.monthlyRent,
        },
        commercial: {
          monthlyRent: commercial.monthlyRent,
          deposit: commercial.deposit,
          paymentDay: commercial.paymentDay,
          durationMonths: commercial.durationMonths ?? null,
          latePenaltyRate: commercial.latePenaltyRate,
          terminationNoticeDays:
            ('noticePeriodDays' in commercial
              ? commercial.noticePeriodDays
              : undefined) ?? commercial.terminationNoticeDays,
        },
        startDate: contract.startDate
          ? new Date(contract.startDate).toISOString()
          : '',
        endDate: contract.endDate
          ? new Date(contract.endDate).toISOString()
          : '',
        executionMethod: contract.executionMethod || 'POC_ECONSENT',
        notarizationStatus: contract.notarizationStatus || 'not-requested',
        executionPolicy,
      },
      document,
      parties: {
        tenant: tenantParty,
        landlord: landlordParty,
      },
      deposit: depositDto,
      actions: {
        canPayDeposit:
          isTenant &&
          !isDepositPaid &&
          [
            'deposit-pending',
            'draft',
            'awaiting-signature',
            'fully-signed-pending-deposit',
          ].includes(contract.status || ''),
        paymentReasonCode: isDepositPaid ? 'DEPOSIT_ALREADY_PAID' : null,
        signingEligibility,
        canDownloadArtifact: Boolean(
          contract.contentLockedHash &&
          contract.artifactRef &&
          artifactAvailable
        ),
        artifactReasonCode: !contract.contentLockedHash
          ? 'CONTENT_NOT_LOCKED'
          : !contract.artifactRef
            ? 'ARTIFACT_NOT_AVAILABLE'
            : !this.artifactService
              ? 'ARTIFACT_STORAGE_UNAVAILABLE'
              : artifactFailure === 'mismatch'
                ? 'ARTIFACT_HASH_MISMATCH'
                : artifactFailure === 'unavailable'
                  ? 'ARTIFACT_STORAGE_UNAVAILABLE'
                  : null,
        canEditContent:
          (isStaff || isLandlord) &&
          !contract.contentLockedHash &&
          ['draft', 'deposit-pending', 'deposit-paid'].includes(
            contract.status ?? ''
          ),
        canLockContent:
          (isStaff || isLandlord) &&
          !contract.contentLockedHash &&
          ['draft', 'deposit-pending', 'deposit-paid'].includes(
            contract.status ?? ''
          ),
      },
      access,
      ledger,
    }
  }

  private deriveSigningEligibility(input: {
    isParticipant: boolean
    role: 'tenant' | 'landlord' | null
    contractStatus: string
    isContentLocked: boolean
    isDepositPaid: boolean
    isKycVerified: boolean
    hasSigned: boolean
    isConfigOutdated: boolean
    executionStrategy: 'DEPOSIT_FIRST' | 'SIGN_FIRST'
  }): SigningEligibilityDto {
    if (!input.isParticipant || !input.role) {
      return {
        eligible: false,
        reasonCode: 'NOT_PARTICIPANT',
        message: 'Bạn không phải bên ký kết của hợp đồng này.',
      }
    }

    if (input.hasSigned) {
      return {
        eligible: false,
        reasonCode: 'ALREADY_SIGNED',
        message: 'Bạn đã hoàn tất xác nhận điện tử hợp đồng này.',
      }
    }

    if (input.isConfigOutdated) {
      return {
        eligible: false,
        reasonCode: 'CONFIG_OUTDATED',
        message: 'Cấu hình hợp đồng đã thay đổi, cần đối soát trước khi ký.',
      }
    }

    if (!input.isContentLocked) {
      return {
        eligible: false,
        reasonCode: 'CONTENT_NOT_LOCKED',
        message: 'Nội dung hợp đồng chưa được khóa để ký.',
      }
    }

    if (input.contractStatus !== 'awaiting-signature') {
      return {
        eligible: false,
        reasonCode: 'WRONG_STATE',
        message:
          'Hợp đồng chưa sẵn sàng để ký kết (cần chờ duyệt hoặc hoàn tất đặt cọc).',
      }
    }

    if (!input.isDepositPaid && input.executionStrategy === 'DEPOSIT_FIRST') {
      return {
        eligible: false,
        reasonCode: 'DEPOSIT_REQUIRED',
        message: 'Cần hoàn tất thanh toán tiền đặt cọc trước khi ký hợp đồng.',
      }
    }

    if (!input.isKycVerified) {
      return {
        eligible: false,
        reasonCode: 'KYC_NOT_VERIFIED',
        message: 'Tài khoản chưa hoàn tất định danh điện tử (KYC).',
      }
    }

    return {
      eligible: true,
      reasonCode: null,
      message: null,
    }
  }
}
