import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { KycRecord } from '../../kyc/schemas/kyc-record.schema'
import { ContractArtifactService } from '../contract-artifact.service'
import { ContractsService } from '../contracts.service'
import { DepositConfirmationResolver } from '../deposit-confirmation.resolver'
import { Contract } from '../schemas/contract.schema'
import {
  SmartCaProvider,
  type SmartCaCertificate,
  type SmartCaSignature,
} from './smartca.provider'
import { SmartCaSigningSession } from './smartca-signing-session.schema'

export type SmartCaSignatureEvidence = {
  artifactHash: string
  certificateSerial?: string
  certificateSubject?: string
  certificateIssuer?: string
  signatureHash?: string
  signatureAlgorithm?: string
  signatureValueRef?: string
  signedAt?: string
}

export type CreateSmartCaSessionInput = {
  idempotencyKey?: string
  certificateSerial?: string
  smartCaPassword: string
  smartCaOtp: string
}

export type SmartCaCertificateList = {
  certificates: SmartCaCertificate[]
}

type ReconciliationStatus = 'pending' | 'signed' | 'rejected'

type SigningContext = {
  contract: Contract
  signerRole: 'tenant' | 'landlord'
  artifactHash: string
  documentId: string
}

@Injectable()
export class SmartCaSigningService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SmartCaSigningSession)
    private readonly sessionRepository: Repository<SmartCaSigningSession>,
    @InjectRepository(KycRecord)
    private readonly kycRepository: Repository<KycRecord>,
    private readonly provider: SmartCaProvider,
    @Optional() private readonly contractsService?: ContractsService,
    @Optional() private readonly artifactService?: ContractArtifactService,
    @Optional()
    private readonly depositConfirmationResolver?: DepositConfirmationResolver
  ) {}

  async listCertificates(
    contractId: string,
    signerId: string
  ): Promise<SmartCaCertificateList> {
    await this.resolveSigningContext(contractId, signerId)
    const signerCccd = await this.resolveCccd(signerId)
    return { certificates: await this.resolveValidCertificates(signerCccd) }
  }

  async createSession(
    contractId: string,
    signerId: string,
    input: CreateSmartCaSessionInput
  ): Promise<SmartCaSigningSession> {
    this.validateCredentials(input)
    const context = await this.resolveSigningContext(contractId, signerId)
    const requestedKey = input.idempotencyKey?.trim()
    const existing = requestedKey
      ? await this.sessionRepository.findOne({
          where: {
            contractId,
            signerId,
            artifactHash: context.artifactHash,
            idempotencyKey: requestedKey,
          },
        })
      : null

    if (existing) {
      if (existing.status !== 'pending') return existing
      if (existing.expiresAt <= new Date()) {
        existing.status = 'expired'
        existing.providerStatus = 'expired'
        return this.sessionRepository.save(existing)
      }
      const recovered = await this.recoverPendingSession(
        existing,
        context.documentId
      )
      if (recovered.status !== 'pending') return recovered
    }

    const signerCccd = await this.resolveCccd(signerId)
    const certificates = await this.resolveValidCertificates(signerCccd)
    const certificate = this.selectCertificate(
      certificates,
      input.certificateSerial ?? existing?.certificateSerial ?? undefined
    )
    const idempotencyKey = requestedKey ?? randomUUID()
    const transactionId = this.createTransactionId(
      contractId,
      context.signerRole,
      idempotencyKey
    )
    const session =
      existing ??
      this.sessionRepository.create({
        contractId,
        signerId,
        signerRole: context.signerRole,
        artifactHash: context.artifactHash,
        providerTransactionId: transactionId,
        status: 'pending',
        idempotencyKey,
        confirmationUrl: null,
        certificateSerial: certificate.serialNumber,
        certificateSubject: certificate.subject ?? null,
        certificateIssuer: certificate.issuer ?? null,
        signatureHash: null,
        signatureAlgorithm: null,
        signatureValueRef: null,
        signedAt: null,
        verifiedAt: null,
        providerStatus: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      })

    if (existing) {
      session.certificateSerial = certificate.serialNumber
      session.certificateSubject = certificate.subject ?? null
      session.certificateIssuer = certificate.issuer ?? null
    }
    await this.sessionRepository.save(session)

    let password = input.smartCaPassword
    let otp = input.smartCaOtp
    let sad: string | undefined
    try {
      const signResult = await this.provider.requestSignature({
        transactionId: session.providerTransactionId,
        artifactHash: context.artifactHash,
        signerCccd,
        password,
        otp,
        certificateSerial: certificate.serialNumber,
        documentId: context.documentId,
      })
      session.providerTransactionId = signResult.transactionId
      session.expiresAt = new Date(Date.now() + signResult.expiresIn * 1000)
      await this.sessionRepository.save(session)
      sad = signResult.sad

      const confirmation = await this.provider.confirmSignature({
        transactionId: signResult.transactionId,
        signerCccd,
        password,
        sad,
        documentId: context.documentId,
      })
      if (confirmation.transactionId !== signResult.transactionId) {
        throw new ConflictException('SMARTCA_TRANSACTION_MISMATCH')
      }
      return this.completeWithSignature(
        session,
        confirmation.signature,
        context.documentId
      )
    } finally {
      password = ''
      otp = ''
      sad = undefined
    }
  }

  async getSession(
    contractId: string,
    sessionId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<SmartCaSigningSession> {
    if (!ObjectId.isValid(sessionId)) {
      throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    }
    const session = await this.sessionRepository.findOne({
      where: { _id: new ObjectId(sessionId), contractId },
    })
    if (!session) throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    if (!isStaff && session.signerId !== actorId) {
      throw new ForbiddenException('SMARTCA_SESSION_ACCESS_DENIED')
    }
    if (session.status === 'pending' && session.expiresAt <= new Date()) {
      session.status = 'expired'
      session.providerStatus = 'expired'
      await this.sessionRepository.save(session)
    }
    return session
  }

  async cancelSession(
    contractId: string,
    sessionId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<SmartCaSigningSession> {
    const session = await this.getSession(
      contractId,
      sessionId,
      actorId,
      isStaff
    )
    if (session.status !== 'pending') return session
    session.status = 'cancelled'
    session.providerStatus = 'cancelled'
    return this.sessionRepository.save(session)
  }

  async poll(
    contractId: string,
    sessionId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<SmartCaSigningSession> {
    const session = await this.getSession(
      contractId,
      sessionId,
      actorId,
      isStaff
    )
    if (session.status !== 'pending') return session

    const context = await this.resolveSigningContext(
      contractId,
      session.signerId
    )
    if (context.artifactHash !== session.artifactHash) {
      throw new ConflictException('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    }
    return this.recoverPendingSession(session, context.documentId)
  }

  async reconcile(
    providerTransactionId: string,
    status: ReconciliationStatus,
    evidence: SmartCaSignatureEvidence
  ): Promise<SmartCaSigningSession> {
    const session = await this.sessionRepository.findOne({
      where: { providerTransactionId },
    })
    if (!session) throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    if (session.status !== 'pending') return session
    if (session.expiresAt <= new Date()) {
      session.status = 'expired'
      session.providerStatus = 'expired'
      return this.sessionRepository.save(session)
    }
    if (evidence.artifactHash !== session.artifactHash) {
      throw new ConflictException('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    }
    if (status === 'signed' && !evidence.certificateSerial) {
      throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    }

    session.status = status
    session.providerStatus = status
    session.certificateSerial = evidence.certificateSerial ?? null
    session.certificateSubject = evidence.certificateSubject ?? null
    session.certificateIssuer = evidence.certificateIssuer ?? null
    session.signatureHash = evidence.signatureHash ?? null
    session.signatureAlgorithm = evidence.signatureAlgorithm ?? null
    session.signatureValueRef = evidence.signatureValueRef ?? null
    session.signedAt =
      status === 'signed'
        ? (this.parseSignedAt(evidence.signedAt) ?? new Date())
        : null
    session.verifiedAt = status === 'signed' ? new Date() : null
    const saved = await this.sessionRepository.save(session)
    await this.syncSignedContract(saved)
    return saved
  }

  private validateCredentials(input: CreateSmartCaSessionInput): void {
    if (!input.smartCaPassword.trim() || !input.smartCaOtp.trim()) {
      throw new BadRequestException('SMARTCA_CREDENTIALS_REQUIRED')
    }
  }

  private async resolveSigningContext(
    contractId: string,
    signerId: string
  ): Promise<SigningContext> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    if (this.artifactService) {
      await this.artifactService.resolveCanonicalArtifact(contract)
    }
    const signerRole =
      contract.tenantId === signerId
        ? 'tenant'
        : contract.landlordId === signerId
          ? 'landlord'
          : null
    if (!signerRole) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (
      contract.status !== 'awaiting-signature' ||
      !contract.contentLockedHash ||
      !contract.artifactRef ||
      contract.artifactRef.contentType !== 'application/pdf'
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_NOT_LOCKED')
    }

    const strategy =
      contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST'
    if (strategy !== 'DEPOSIT_FIRST' && strategy !== 'SIGN_FIRST') {
      throw new ConflictException('UNSUPPORTED_RENTAL_EXECUTION_STRATEGY')
    }
    if (strategy === 'DEPOSIT_FIRST' && contract.deposit > 0) {
      // Nguồn sự thật duy nhất cho "cọc đã xác nhận": dùng
      // DepositConfirmationResolver (đọc cả trạng thái thỏa thuận cọc, không
      // chỉ contract.depositPaidAt vốn chỉ được ghi lúc kích hoạt). Khi
      // resolver chưa được wire (ví dụ test cũ không set), giữ hành vi cũ.
      const depositConfirmed = this.depositConfirmationResolver
        ? (await this.depositConfirmationResolver.resolve(contract)).confirmed
        : Boolean(contract.depositPaidAt)
      if (!depositConfirmed) {
        throw new ConflictException(
          'EXECUTION_POLICY_DEPOSIT_REQUIRED_BEFORE_SIGNING'
        )
      }
    }

    return {
      contract,
      signerRole,
      artifactHash: contract.artifactRef.artifactHash,
      documentId: `contract-${contractId}-r${contract.artifactRef.revision}`,
    }
  }

  private async resolveCccd(userId: string): Promise<string> {
    const kyc = await this.kycRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    })
    if (!kyc) throw new ConflictException('SMARTCA_KYC_REQUIRED')
    if (kyc.status !== 'verified' || !kyc.idCardNumber?.trim()) {
      throw new ConflictException('SMARTCA_KYC_NOT_VERIFIED')
    }
    return kyc.idCardNumber.trim()
  }

  private async resolveValidCertificates(
    signerCccd: string
  ): Promise<SmartCaCertificate[]> {
    const certificates = (
      await this.provider.listCertificates(signerCccd)
    ).filter(certificate => certificate.isValid)
    const uniqueSerials = new Set(
      certificates.map(certificate => certificate.serialNumber)
    )
    if (uniqueSerials.size !== certificates.length) {
      throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    }
    return certificates
  }

  private selectCertificate(
    certificates: SmartCaCertificate[],
    requestedSerial: string | undefined
  ): SmartCaCertificate {
    if (certificates.length === 0) {
      throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    }
    if (requestedSerial) {
      const selected = certificates.find(
        certificate => certificate.serialNumber === requestedSerial
      )
      if (!selected) {
        throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
      }
      return selected
    }
    const onlyCertificate = certificates[0]
    if (certificates.length === 1 && onlyCertificate) return onlyCertificate
    throw new ConflictException({
      message: 'SMARTCA_CERTIFICATE_SELECTION_REQUIRED',
      certificates,
    })
  }

  private createTransactionId(
    contractId: string,
    signerRole: 'tenant' | 'landlord',
    idempotencyKey: string
  ): string {
    const suffix = createHash('sha256')
      .update(idempotencyKey)
      .digest('hex')
      .slice(0, 24)
    return `contract-${contractId}-${signerRole}-${suffix}`
  }

  private async recoverPendingSession(
    session: SmartCaSigningSession,
    documentId: string
  ): Promise<SmartCaSigningSession> {
    const providerResult = await this.provider.getSignatureStatus(
      session.providerTransactionId,
      documentId
    )
    if (providerResult.status === 'pending') return session
    if (providerResult.status === 'rejected') {
      session.status = 'rejected'
      session.providerStatus = 'rejected'
      return this.sessionRepository.save(session)
    }
    if (!providerResult.signature) {
      throw new ConflictException('SMARTCA_PROVIDER_RESPONSE_INVALID')
    }
    return this.completeWithSignature(
      session,
      providerResult.signature,
      documentId
    )
  }

  private async completeWithSignature(
    session: SmartCaSigningSession,
    signature: SmartCaSignature,
    documentId: string
  ): Promise<SmartCaSigningSession> {
    if (signature.documentId !== documentId) {
      throw new ConflictException('SMARTCA_PROVIDER_RESPONSE_INVALID')
    }
    if (!session.certificateSerial) {
      throw new ConflictException('SMARTCA_CERTIFICATE_INVALID')
    }
    session.status = 'signed'
    session.providerStatus = 'signed'
    session.signatureHash = createHash('sha256')
      .update(signature.signatureValue)
      .digest('hex')
    session.signatureValueRef = signature.signatureValue
    session.signatureAlgorithm = null
    session.signedAt =
      this.parseSignedAt(signature.signedAt ?? undefined) ?? new Date()
    session.verifiedAt = new Date()
    const saved = await this.sessionRepository.save(session)
    await this.syncSignedContract(saved)
    return saved
  }

  private async syncSignedContract(
    session: SmartCaSigningSession
  ): Promise<void> {
    if (
      session.status !== 'signed' ||
      !this.contractsService ||
      !session.signedAt ||
      !session.certificateSerial
    ) {
      return
    }
    await this.contractsService.recordSmartCaSignature({
      contractId: session.contractId,
      signerId: session.signerId,
      role: session.signerRole,
      artifactHash: session.artifactHash,
      providerTransactionId: session.providerTransactionId,
      certificateSerial: session.certificateSerial,
      certificateSubject: session.certificateSubject ?? null,
      certificateIssuer: session.certificateIssuer ?? null,
      signatureHash: session.signatureHash ?? null,
      signatureAlgorithm: session.signatureAlgorithm ?? null,
      signatureValueRef: session.signatureValueRef ?? null,
      signedAt: session.signedAt,
    })
  }

  private parseSignedAt(value: string | undefined): Date | null {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
}
