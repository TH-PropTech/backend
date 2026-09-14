import {
  Injectable,
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
import {
  ContractViewDto,
  ContractPartyViewDto,
  ContractDepositViewDto,
  SigningEligibilityDto,
  ContractLedgerSummaryDto,
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
    @Optional() private readonly fabricService?: FabricService
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

    if (!isStaff && !isTenant && !isLandlord) {
      throw new ForbiddenException('CONTRACT_ACCESS_DENIED')
    }

    // 1. Chiếu cấu trúc văn bản pháp lý
    const document = ContractDocumentProjector.projectDocument(contract)

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

    const ledger: ContractLedgerSummaryDto = {
      networkMode: currentMode,
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
          monthlyRent: contract.monthlyRent,
          deposit: contract.deposit,
          paymentDay: contract.paymentDay,
          durationMonths: contract.durationMonths ?? null,
          latePenaltyRate: contract.latePenaltyRate || 10,
          terminationNoticeDays: contract.terminationNoticeDays || 30,
        },
        startDate: contract.startDate
          ? new Date(contract.startDate).toISOString()
          : '',
        endDate: contract.endDate
          ? new Date(contract.endDate).toISOString()
          : '',
        executionMethod: contract.executionMethod || 'POC_ECONSENT',
        notarizationStatus: contract.notarizationStatus || 'not-requested',
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
          ['deposit-pending', 'draft'].includes(contract.status || ''),
        paymentReasonCode: isDepositPaid ? 'DEPOSIT_ALREADY_PAID' : null,
        signingEligibility,
        canDownloadArtifact: Boolean(contract.contentLockedHash),
        artifactReasonCode: !contract.contentLockedHash
          ? 'CONTENT_NOT_LOCKED'
          : null,
      },
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

    if (!input.isDepositPaid) {
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
