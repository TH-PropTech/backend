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
import { Contract } from '../schemas/contract.schema'
import { DepositAgreement } from '../schemas/deposit-agreement.schema'
import { KycService } from '../../users/services/kyc.service'
import { LedgerAuditQueryService } from '../../fabric/services/ledger-audit-query.service'
import { FabricService } from '../../fabric/services/fabric.service'
import { ContractDocumentProjector } from '../legal/contract-document.projector'
import { OwnershipTransferResolver } from './ownership-transfer.resolver'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractTemplateGovernanceService } from '../legal/contract-template-governance.service'
import { ContractAmendment } from '../schemas/contract-amendment.schema'
import { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'
import { resolveEffectiveCommercial } from '../commercial/resolve-effective-commercial'
import {
  resolveDepositConfirmation,
  type DepositConfirmation,
} from './deposit-confirmation.resolver'
import { evaluatePayDeposit, evaluateSigning } from '../flow/flow-guards'
import { isTestSignBypassEnabled } from '../utils/test-sign-bypass'
import {
  projectContractFlow,
  type ContractFlowFacts,
} from '../flow/contract-flow.projector'
import {
  ContractViewDto,
  ContractPartyViewDto,
  ContractDepositViewDto,
  SigningEligibilityDto,
  ContractLedgerSummaryDto,
  ContractExecutionPolicyViewDto,
} from '../dto/contract-view.dto'

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
    private readonly amendmentRepository?: Repository<ContractAmendment>,
    @Optional()
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository?: Repository<MoveInSettlement>
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
    let depositAgreement: DepositAgreement | null = null

    if (
      contract.depositAgreementId &&
      ObjectId.isValid(contract.depositAgreementId)
    ) {
      depositAgreement = await this.depositAgreementRepository.findOne({
        where: { _id: new ObjectId(contract.depositAgreementId) },
      })
      if (depositAgreement) {
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

    const depositConfirmation = resolveDepositConfirmation(
      {
        deposit: contract.deposit,
        depositPaidAt: contract.depositPaidAt ?? null,
      },
      depositAgreement
        ? {
            id: depositAgreement._id.toHexString(),
            status: depositAgreement.status,
            amount: depositAgreement.amount,
            paidAt: depositAgreement.paidAt ?? null,
          }
        : null
    )
    const isDepositPaid = depositConfirmation.confirmed

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

    const signingEligibility: SigningEligibilityDto = evaluateSigning({
      isParticipant: currentActorRole !== null,
      hasSigned: Boolean(hasCurrentActorSigned),
      isConfigOutdated: contract.configStatus === 'CONFIG_OUTDATED',
      isContentLocked: Boolean(
        contract.contentLockedHash && contract.contentLockedAt
      ),
      requiresArtifact: contract.executionMethod === 'SMARTCA',
      hasArtifact: Boolean(contract.artifactRef),
      contractStatus: contract.status || 'draft',
      strategy: executionStrategy,
      isDepositConfirmed: isDepositPaid,
      isKycVerified:
        isTestSignBypassEnabled() || currentActorKyc?.status === 'verified',
    })
    const payGuard = evaluatePayDeposit(
      depositAgreement
        ? {
            status: depositAgreement.status,
            hasConsent: Boolean(depositAgreement.tenantConsent),
          }
        : null
    )

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

    const commercial = resolveEffectiveCommercial(contract)
    const settlement = this.settlementRepository
      ? await this.settlementRepository.findOne({ where: { contractId } })
      : null
    const feeLines = contract.feeSnapshot?.quote ?? []
    const tenantServiceFee =
      feeLines.find(line => line.payerRole === 'tenant')?.amount ?? 0
    const landlordCommission =
      isLandlord || isStaff
        ? (feeLines.find(line => line.payerRole === 'landlord')?.amount ?? 0)
        : 0
    const holdingDeposit =
      contract.packageSnapshot?.resolvedHoldingDepositAmount ?? contract.deposit
    const securityTopUpAmount = Math.max(0, contract.deposit - holdingDeposit)
    const initialPaymentTotal = (settlement?.lines ?? []).reduce(
      (sum, line) => sum + line.amount,
      0
    )

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
        canPayDeposit: isTenant && !isDepositPaid && payGuard.enabled,
        paymentReasonCode: isDepositPaid
          ? 'DEPOSIT_ALREADY_PAID'
          : payGuard.reasonCode,
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
        canLockArtifact:
          (isStaff || isLandlord) &&
          Boolean(contract.contentLockedHash) &&
          !contract.artifactRef,
      },
      access,
      ledger,
      flow: projectContractFlow(
        this.buildFlowFacts(contract, {
          depositAgreement,
          depositConfirmation,
          kycVerified: {
            tenant:
              isTestSignBypassEnabled() || tenantKyc?.status === 'verified',
            landlord:
              isTestSignBypassEnabled() || landlordKyc?.status === 'verified',
          },
          ledgerStatus,
          viewer: { isTenant, isLandlord, isStaff },
          settlement: settlement
            ? {
                required: true,
                status: settlement.status,
                handoverRecorded: Boolean(settlement.handover),
                handoverCompleted: Boolean(settlement.handover?.completedAt),
                completedAt: settlement.handover?.completedAt ?? null,
              }
            : undefined,
          fees: {
            tenantDue: Boolean(
              feeLines.find(line => line.payerRole === 'tenant')?.amount
            ),
            landlordDue: Boolean(
              feeLines.find(line => line.payerRole === 'landlord')?.amount
            ),
          },
        })
      ),
      settlement: settlement
        ? {
            id: settlement._id.toHexString(),
            status: settlement.status,
            total: settlement.total,
            dueAt: settlement.dueAt.toISOString(),
            statementHash: settlement.statementHash,
            lines: settlement.lines.map(line => ({
              kind: line.kind,
              amount: line.amount,
              paymentId: line.paymentId,
            })),
            handover: settlement.handover ?? null,
          }
        : null,
      financialSummary: {
        initialPaymentTotal,
        holdingDeposit,
        securityTopUpAmount,
        tenantServiceFee,
        landlordCommission,
      },
    }
  }

  private buildFlowFacts(
    contract: Contract,
    context: Pick<ContractFlowFacts, 'kycVerified' | 'viewer'> & {
      depositAgreement: DepositAgreement | null
      depositConfirmation: DepositConfirmation
      ledgerStatus: ContractLedgerSummaryDto['status']
      settlement?: ContractFlowFacts['settlement']
      fees?: ContractFlowFacts['fees']
    }
  ): ContractFlowFacts {
    const { depositAgreement: agreement, depositConfirmation } = context
    const signedAt = (value?: Date | string | null): Date | null =>
      value ? new Date(value) : null
    return {
      strategy: contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST',
      contractStatus: contract.status || 'draft',
      executionMethod: contract.executionMethod || 'POC_ECONSENT',
      isConfigOutdated: contract.configStatus === 'CONFIG_OUTDATED',
      agreement: agreement
        ? {
            status: agreement.status,
            hasConsent: Boolean(agreement.tenantConsent),
            consentedAt: agreement.tenantConsent?.consentedAt ?? null,
            contentRevision: agreement.contentRevision ?? null,
            contentHash: agreement.contentHash ?? null,
          }
        : null,
      deposit: {
        required: depositConfirmation.required,
        confirmed: depositConfirmation.confirmed,
        paidAt: depositConfirmation.paidAt,
      },
      contentLockedAt: contract.contentLockedHash
        ? (contract.contentLockedAt ?? null)
        : null,
      hasArtifact: Boolean(contract.artifactRef),
      signatures: {
        tenant: {
          signed: Boolean(contract.signedByTenant),
          signedAt: signedAt(contract.tenantSignature?.signedAt),
        },
        landlord: {
          signed: Boolean(contract.signedByLandlord),
          signedAt: signedAt(contract.landlordSignature?.signedAt),
        },
      },
      kycVerified: context.kycVerified,
      activationFailureCode: contract.activationFailure?.code ?? null,
      ledger: {
        status: context.ledgerStatus,
        recordedAt: contract.ledgerRecordedAt ?? null,
      },
      viewer: context.viewer,
      ...(context.settlement ? { settlement: context.settlement } : {}),
      ...(context.fees ? { fees: context.fees } : {}),
    }
  }
}
