import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { In, Repository } from 'typeorm'
import { Contract } from '../schemas/contract.schema'
import { ContractsService } from '../contracts.service'
import { SmartCaProvider } from './smartca.provider'
import { SmartCaSigningSession } from './smartca-signing-session.schema'
import { ContractArtifactService } from '../contract-artifact.service'

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

type ReconciliationStatus = 'pending' | 'signed' | 'rejected'

@Injectable()
export class SmartCaSigningService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SmartCaSigningSession)
    private readonly sessionRepository: Repository<SmartCaSigningSession>,
    private readonly provider: SmartCaProvider,
    @Optional() private readonly contractsService?: ContractsService,
    @Optional() private readonly artifactService?: ContractArtifactService
  ) {}

  async createSession(
    contractId: string,
    signerId: string,
    idempotencyKey?: string
  ): Promise<SmartCaSigningSession> {
    if (!ObjectId.isValid(contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
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
    const artifactHash = contract.artifactRef.artifactHash

    const strategy =
      contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST'
    if (strategy !== 'DEPOSIT_FIRST' && strategy !== 'SIGN_FIRST') {
      throw new ConflictException('UNSUPPORTED_RENTAL_EXECUTION_STRATEGY')
    }
    if (
      strategy === 'DEPOSIT_FIRST' &&
      contract.deposit > 0 &&
      !contract.depositPaidAt
    ) {
      throw new ConflictException(
        'EXECUTION_POLICY_DEPOSIT_REQUIRED_BEFORE_SIGNING'
      )
    }

    const existing = await this.sessionRepository.findOne({
      where: {
        contractId,
        signerId,
        artifactHash,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        status: In(['pending', 'signed']),
      },
    })
    if (existing) {
      if (existing.status === 'pending' && existing.expiresAt <= new Date()) {
        if (idempotencyKey) return existing
        existing.status = 'expired'
        await this.sessionRepository.save(existing)
      } else {
        return existing
      }
    }

    const transactionSuffix = idempotencyKey ?? Date.now().toString(36)
    const providerResult = await this.provider.requestSignature({
      transactionId: `contract-${contractId}-${signerRole}-${transactionSuffix}`,
      artifactHash,
      signerId,
      signerRole,
    })
    if (
      providerResult.artifactHash &&
      providerResult.artifactHash !== artifactHash
    ) {
      throw new ConflictException('SMARTCA_SIGNATURE_DIGEST_MISMATCH')
    }

    const session = this.sessionRepository.create({
      contractId,
      signerId,
      signerRole,
      artifactHash,
      providerTransactionId: providerResult.transactionId,
      status: providerResult.status,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      confirmationUrl: providerResult.confirmationUrl ?? null,
      certificateSerial: providerResult.certificateSerial ?? null,
      certificateSubject: providerResult.certificateSubject ?? null,
      certificateIssuer: providerResult.certificateIssuer ?? null,
      signatureHash: providerResult.signatureHash ?? null,
      signatureAlgorithm: providerResult.signatureAlgorithm ?? null,
      signatureValueRef: providerResult.signatureValueRef ?? null,
      signedAt: this.parseSignedAt(providerResult.signedAt),
      verifiedAt: providerResult.status === 'signed' ? new Date() : null,
      providerStatus: providerResult.status,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })
    return this.sessionRepository.save(session)
  }

  async getSession(
    contractId: string,
    sessionId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<SmartCaSigningSession> {
    if (!ObjectId.isValid(sessionId))
      throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    const session = await this.sessionRepository.findOne({
      where: { _id: new ObjectId(sessionId), contractId },
    })
    if (!session) throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    if (!isStaff && session.signerId !== actorId)
      throw new ForbiddenException('SMARTCA_SESSION_ACCESS_DENIED')
    if (session.status === 'pending' && session.expiresAt <= new Date()) {
      session.status = 'expired'
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
    if (
      session.status === 'signed' ||
      session.status === 'rejected' ||
      session.status === 'expired' ||
      session.status === 'cancelled'
    ) {
      return session
    }
    session.status = 'cancelled'
    session.providerStatus = 'cancelled'
    return this.sessionRepository.save(session)
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
    const providerResult = await this.provider.getSignatureStatus(
      session.providerTransactionId
    )
    return this.reconcile(
      session.providerTransactionId,
      providerResult.status,
      {
        artifactHash: providerResult.artifactHash ?? session.artifactHash,
        ...(providerResult.certificateSerial
          ? { certificateSerial: providerResult.certificateSerial }
          : {}),
        ...(providerResult.certificateSubject
          ? { certificateSubject: providerResult.certificateSubject }
          : {}),
        ...(providerResult.certificateIssuer
          ? { certificateIssuer: providerResult.certificateIssuer }
          : {}),
        ...(providerResult.signatureHash
          ? { signatureHash: providerResult.signatureHash }
          : {}),
        ...(providerResult.signatureAlgorithm
          ? { signatureAlgorithm: providerResult.signatureAlgorithm }
          : {}),
        ...(providerResult.signatureValueRef
          ? { signatureValueRef: providerResult.signatureValueRef }
          : {}),
        ...(providerResult.signedAt
          ? { signedAt: providerResult.signedAt }
          : {}),
      }
    )
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
    if (
      session.status === 'signed' ||
      session.status === 'rejected' ||
      session.status === 'expired' ||
      session.status === 'cancelled'
    ) {
      return session
    }
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

  private parseSignedAt(value: string | undefined): Date | null {
    if (!value) return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
}
