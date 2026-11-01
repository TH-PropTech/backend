import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { KycService } from '../../users/services/kyc.service'
import { ContractArtifactService } from './contract-artifact.service'
import { ContractsService } from './contracts.service'
import { DepositConfirmationResolver } from './deposit-confirmation.resolver'
import { Contract } from '../schemas/contract.schema'
import { SignedArtifactService } from '../signed-artifact/signed-artifact.service'
import {
  isSigningMethodEnabled,
  resolveEnabledSigningMethods,
  type SigningMethodId,
} from '../utils/signing-methods.config'
import {
  SmartCaProvider,
  type SmartCaCertificate,
  type SmartCaSignature,
} from '../providers/smartca.provider'
import { SmartCaSigningSession } from '../schemas/smartca-signing-session.schema'
import { KindScopedSmartCaSigningRepository } from '../utils/signing-session.repository'
import {
  SMARTCA_EVENTS_PUBLISHER,
  type SmartCaEventsPublisher,
  type SmartCaSessionUpdatedEvent,
} from '../gateways/smartca-events.publisher'

export type CreateSmartCaSessionInput = {
  idempotencyKey?: string
  certificateSerial?: string
}

export type CreateSmartCaSessionV2Input = CreateSmartCaSessionInput & {
  /** Secret dùng một lần: chỉ tồn tại trong bộ nhớ của request, không persist/log. */
  password: string
  otp: string
}

export type SigningMethodOption = {
  id: SigningMethodId
  label: string
  description: string
  available: boolean
  reason?: string
  inputs: Array<'smartCaPassword' | 'smartCaOtp'>
}

const SIGNING_METHOD_LABELS: Record<
  SigningMethodId,
  { label: string; description: string }
> = {
  smartca_v1: {
    label: 'VNPT SmartCA (xác nhận trên app)',
    description: 'Gửi yêu cầu ký, bạn duyệt trong ứng dụng VNPT SmartCA.',
  },
  smartca_v2: {
    label: 'VNPT SmartCA (mật khẩu + OTP)',
    description: 'Nhập mật khẩu và OTP SmartCA TH để ký ngay trong ứng dụng.',
  },
  dev_sign: {
    label: 'Ký thử nghiệm (dev)',
    description:
      'Chỉ dùng môi trường thử nghiệm, không phải chữ ký số có chứng thư.',
  },
}

export type SmartCaCertificateList = {
  certificates: SmartCaCertificate[]
}

type SigningContext = {
  contract: Contract
  signerRole: 'tenant' | 'landlord'
  artifactHash: string
  documentId: string
}

@Injectable()
export class SmartCaSigningService {
  private readonly logger = new Logger(SmartCaSigningService.name)

  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SmartCaSigningSession)
    sessionStore: Repository<SmartCaSigningSession>,
    private readonly kycService: KycService,
    private readonly provider: SmartCaProvider,
    @Optional() private readonly contractsService?: ContractsService,
    @Optional() private readonly artifactService?: ContractArtifactService,
    @Optional()
    private readonly depositConfirmationResolver?: DepositConfirmationResolver,
    @Optional()
    @Inject(SMARTCA_EVENTS_PUBLISHER)
    private readonly eventsPublisher?: SmartCaEventsPublisher,
    @Optional()
    private readonly signedArtifactService?: SignedArtifactService
  ) {
    this.sessionRepository = new KindScopedSmartCaSigningRepository(
      sessionStore,
      'session'
    )
  }

  /** Phiên SmartCA (kind='session') trên bảng hợp nhất; mọi truy vấn tự thêm kind. */
  private readonly sessionRepository: KindScopedSmartCaSigningRepository

  private readonly webhookInFlight = new Map<string, Promise<void>>()
  private readonly publishedTerminalEvents = new Set<string>()

  async listCertificates(
    contractId: string,
    signerId: string
  ): Promise<SmartCaCertificateList> {
    await this.resolveSigningContext(contractId, signerId)
    const signerCccd = await this.resolveCccd(signerId)
    return { certificates: await this.resolveValidCertificates(signerCccd) }
  }

  /** Danh sách phương thức ký bật theo cấu hình, kèm khả năng dùng của participant. */
  async listSigningMethods(
    contractId: string,
    signerId: string
  ): Promise<SigningMethodOption[]> {
    let gateReason: string | undefined
    try {
      await this.resolveSigningContext(contractId, signerId)
    } catch (error) {
      if (!(error instanceof HttpException)) throw error
      gateReason = this.errorCode(error)
    }
    let kycReason: string | undefined
    try {
      await this.resolveCccd(signerId)
    } catch (error) {
      if (!(error instanceof HttpException)) throw error
      kycReason = this.errorCode(error)
    }

    return resolveEnabledSigningMethods().map(id => {
      const reason = id === 'dev_sign' ? undefined : (gateReason ?? kycReason)
      return {
        id,
        ...SIGNING_METHOD_LABELS[id],
        available: reason === undefined,
        ...(reason ? { reason } : {}),
        inputs:
          id === 'smartca_v2'
            ? (['smartCaPassword', 'smartCaOtp'] as const).map(value => value)
            : [],
      }
    })
  }

  /**
   * SmartCA v2 (tùy chọn): sign bằng mật khẩu + OTP, rồi confirm bằng sad trong
   * cùng request. Mật khẩu/OTP/sad không được lưu hay log.
   */
  async createSessionV2(
    contractId: string,
    signerId: string,
    input: CreateSmartCaSessionV2Input
  ): Promise<SmartCaSigningSession> {
    if (!isSigningMethodEnabled('smartca_v2')) {
      throw new ForbiddenException('SIGNING_METHOD_DISABLED')
    }
    const context = await this.resolveSigningContext(contractId, signerId)
    const alreadySigned = await this.sessionRepository.findOne({
      where: {
        contractId,
        signerId,
        artifactHash: context.artifactHash,
        status: 'signed',
      },
    })
    if (alreadySigned) return alreadySigned

    const signerCccd = await this.resolveCccd(signerId)
    const certificates = await this.resolveValidCertificates(signerCccd)
    const certificate = this.selectCertificate(
      certificates,
      input.certificateSerial
    )
    const idempotencyKey = input.idempotencyKey?.trim() || randomUUID()
    const transactionId = this.createTransactionId(
      contractId,
      context.signerRole,
      idempotencyKey
    )
    const session = this.sessionRepository.create({
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
      documentId: context.documentId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    await this.sessionRepository.save(session)

    let signature: SmartCaSignature
    try {
      const signedCopy = await this.prepareSignedCopy(
        context,
        signerId,
        signerCccd,
        certificate.serialNumber
      )
      if (signedCopy) {
        session.signedArtifactId = signedCopy.id
        await this.sessionRepository.save(session)
      }
      const signResult = await this.provider.signV2({
        transactionId: session.providerTransactionId,
        artifactHash: signedCopy?.digest ?? context.artifactHash,
        signerCccd,
        certificateSerial: certificate.serialNumber,
        documentId: context.documentId,
        password: input.password,
        otp: input.otp,
      })
      session.providerTransactionId = signResult.transactionId
      if (signResult.signature) {
        signature = signResult.signature
      } else if (signResult.sad) {
        try {
          signature = await this.provider.confirmV2({
            signerCccd,
            password: input.password,
            transactionId: signResult.transactionId,
            documentId: context.documentId,
            sad: signResult.sad,
          })
        } catch (error) {
          await this.saveTerminalSession(session, 'rejected')
          throw error
        }
      } else {
        throw new ConflictException('SMARTCA_PROVIDER_RESPONSE_INVALID')
      }
    } catch (error) {
      if (session.status === 'pending') {
        await this.discardSignedCopy(session, 'SMARTCA_REQUEST_REJECTED')
        await this.sessionRepository.remove(session)
      }
      throw error
    }
    return this.completeWithSignature(session, signature, context.documentId)
  }

  async createSession(
    contractId: string,
    signerId: string,
    input: CreateSmartCaSessionInput
  ): Promise<SmartCaSigningSession> {
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
        return this.saveTerminalSession(existing, 'expired')
      }
      return this.recoverPendingSession(existing, context.documentId)
    }

    const signerCccd = await this.resolveCccd(signerId)
    const certificates = await this.resolveValidCertificates(signerCccd)
    const certificate = this.selectCertificate(
      certificates,
      input.certificateSerial
    )
    const idempotencyKey = requestedKey ?? randomUUID()
    const transactionId = this.createTransactionId(
      contractId,
      context.signerRole,
      idempotencyKey
    )
    const session = this.sessionRepository.create({
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
      documentId: context.documentId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    await this.sessionRepository.save(session)

    try {
      const signedCopy = await this.prepareSignedCopy(
        context,
        signerId,
        signerCccd,
        certificate.serialNumber
      )
      if (signedCopy) {
        session.signedArtifactId = signedCopy.id
        await this.sessionRepository.save(session)
      }
      const signResult = await this.provider.requestSignature({
        transactionId: session.providerTransactionId,
        artifactHash: signedCopy?.digest ?? context.artifactHash,
        signerCccd,
        certificateSerial: certificate.serialNumber,
        documentId: context.documentId,
      })
      session.providerTransactionId = signResult.transactionId
      return this.sessionRepository.save(session)
    } catch (error) {
      if (this.isDefiniteRejection(error)) {
        await this.discardSignedCopy(session, 'SMARTCA_REQUEST_REJECTED')
        await this.sessionRepository.remove(session)
      }
      throw error
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
      return this.saveTerminalSession(session, 'expired')
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
    return this.saveTerminalSession(session, 'cancelled')
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

  /**
   * Webhook của VNPT chỉ là tín hiệu (§3.5). Hệ thống luôn xác minh lại bằng
   * status API trước khi ghi nhận chữ ký; mọi lỗi được nuốt và log vì VNPT
   * luôn cần nhận 200. In-flight dedupe theo transaction tránh webhook lặp
   * gọi status API nhiều lần.
   */
  async handleWebhook(transactionId: string): Promise<void> {
    const inFlight = this.webhookInFlight.get(transactionId)
    if (inFlight) return inFlight

    const task = this.processWebhook(transactionId).finally(() => {
      this.webhookInFlight.delete(transactionId)
    })
    this.webhookInFlight.set(transactionId, task)
    return task
  }

  private async processWebhook(transactionId: string): Promise<void> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { providerTransactionId: transactionId },
      })
      if (!session || session.status !== 'pending' || !session.documentId) {
        return
      }
      await this.recoverPendingSession(session, session.documentId)
    } catch {
      const correlationId = createHash('sha256')
        .update(transactionId)
        .digest('hex')
        .slice(0, 12)
      this.logger.warn(
        `SmartCA webhook reconciliation failed correlation=${correlationId}`
      )
    }
  }

  private isDefiniteRejection(error: unknown): boolean {
    return !(error instanceof ServiceUnavailableException)
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

    return {
      contract,
      signerRole,
      artifactHash: contract.artifactRef.artifactHash,
      documentId: `contract-${contractId}-r${contract.artifactRef.revision}`,
    }
  }

  private async resolveCccd(userId: string): Promise<string> {
    // Hồ sơ KYC nhúng trong User (G-KYC): một hồ sơ mỗi người dùng
    const kyc = await this.kycService.findByUserId(userId)
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
    fallbackDocumentId: string
  ): Promise<SmartCaSigningSession> {
    const documentId = session.documentId ?? fallbackDocumentId
    const providerResult = await this.provider.getSignatureStatus(
      session.providerTransactionId,
      documentId
    )
    if (providerResult.status === 'pending') return session
    if (providerResult.status === 'rejected') {
      return this.saveTerminalSession(session, 'rejected')
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
    await this.finalizeSignedCopy(saved, signature.signatureValue)
    await this.publishTerminalSession(saved)
    return saved
  }

  /**
   * PAdES (tùy chọn): chuẩn bị bản PDF đã ký và trả digest để SmartCA ký thay cho
   * hash canonical. Trả null khi tắt cờ, dùng provider mock hoặc không có chứng thư.
   */
  private async prepareSignedCopy(
    context: SigningContext,
    signerId: string,
    signerCccd: string,
    certificateSerial: string
  ): Promise<{ id: string; digest: string } | null> {
    if (!this.signedArtifactService) return null
    if (!this.signedArtifactService.isEnabled()) {
      if (process.env['SMARTCA_PADES_ENABLED'] === 'true') {
        this.logger.warn(
          'PAdES bật trong cấu hình nhưng không áp dụng cho phiên ký này (SMARTCA_ENV=mock?): chữ ký sẽ KHÔNG được nhúng vào PDF'
        )
      }
      return null
    }
    if (!('getCertificateMaterial' in this.provider)) {
      this.logger.warn(
        'Provider ký không hỗ trợ lấy chứng thư: chữ ký sẽ KHÔNG được nhúng vào PDF'
      )
      return null
    }
    // PAdES đã bật thì không được ký "lặng lẽ" mà thiếu bản nhúng: lỗi chuẩn bị làm hỏng phiên
    // (phiên bị gỡ, người ký thử lại) thay vì để hợp đồng ký xong mà PDF không có chữ ký.
    try {
      const material = await this.provider.getCertificateMaterial(
        signerCccd,
        certificateSerial
      )
      const prepared = await this.signedArtifactService.prepare({
        contract: context.contract,
        signerId,
        signerRole: context.signerRole,
        signerPem: material.signerPem,
        chainPem: material.chainPem,
        signerName:
          (context.signerRole === 'landlord'
            ? context.contract.landlordName
            : context.contract.tenantName) || 'Người ký',
        certificateSerial,
      })
      return { id: prepared.id, digest: prepared.signedAttrsDigest }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown'
      this.logger.error(
        `Không chuẩn bị được bản PDF đã ký (contract=${context.contract._id.toHexString()}, role=${context.signerRole}): ${reason}`
      )
      throw new ConflictException('SIGNED_ARTIFACT_PREPARE_FAILED')
    }
  }

  private async finalizeSignedCopy(
    session: SmartCaSigningSession,
    signatureValue: string
  ): Promise<void> {
    if (!session.signedArtifactId || !this.signedArtifactService) return
    const sessionId = session._id?.toHexString()
    if (sessionId) {
      await this.signedArtifactService.attachSession(
        session.signedArtifactId,
        sessionId
      )
    }
    // Lỗi nhúng không làm mất chữ ký hợp lệ: bản đã ký ghi trạng thái failed để thử lại.
    await this.signedArtifactService.finalize(
      session.signedArtifactId,
      signatureValue
    )
  }

  private async discardSignedCopy(
    session: SmartCaSigningSession,
    errorCode: string
  ): Promise<void> {
    if (!session.signedArtifactId || !this.signedArtifactService) return
    await this.signedArtifactService.markFailed(
      session.signedArtifactId,
      errorCode
    )
  }

  private async saveTerminalSession(
    session: SmartCaSigningSession,
    status: SmartCaSessionUpdatedEvent['status']
  ): Promise<SmartCaSigningSession> {
    session.status = status
    session.providerStatus = status
    await this.discardSignedCopy(session, `SESSION_${status.toUpperCase()}`)
    const saved = await this.sessionRepository.save(session)
    await this.publishTerminalSession(saved)
    return saved
  }

  private async publishTerminalSession(
    session: SmartCaSigningSession
  ): Promise<void> {
    if (!this.eventsPublisher || session.status === 'pending' || !session._id) {
      return
    }
    const sessionId = session._id.toHexString()
    const eventKey = `${sessionId}:${session.status}`
    if (this.publishedTerminalEvents.has(eventKey)) return
    this.publishedTerminalEvents.add(eventKey)

    try {
      await this.eventsPublisher.publish({
        contractId: session.contractId,
        sessionId,
        status: session.status,
      })
    } catch {
      this.logger.warn(
        `SmartCA realtime publish failed session=${sessionId} status=${session.status}`
      )
    }
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

  private errorCode(error: HttpException): string {
    const response = error.getResponse()
    if (typeof response === 'string') return response
    const message = (response as { message?: unknown }).message
    return typeof message === 'string' ? message : error.name
  }

  private parseSignedAt(value: string | undefined): Date | null {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
}
