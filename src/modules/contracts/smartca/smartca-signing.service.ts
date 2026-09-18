import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from '../schemas/contract.schema'
import { SmartCaProvider } from './smartca.provider'
import { SmartCaSigningSession } from './smartca-signing-session.schema'

@Injectable()
export class SmartCaSigningService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(SmartCaSigningSession)
    private readonly sessionRepository: Repository<SmartCaSigningSession>,
    private readonly provider: SmartCaProvider
  ) {}

  async createSession(
    contractId: string,
    signerId: string
  ): Promise<SmartCaSigningSession> {
    if (!ObjectId.isValid(contractId))
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    const signerRole =
      contract.tenantId === signerId
        ? 'tenant'
        : contract.landlordId === signerId
          ? 'landlord'
          : null
    if (!signerRole) throw new ForbiddenException('CONTRACT_SIGN_ACCESS_DENIED')
    if (
      contract.status !== 'awaiting-signature' ||
      !contract.contentLockedHash
    ) {
      throw new ConflictException('CONTRACT_NOT_READY_FOR_SMARTCA')
    }
    if (
      (contract.executionPolicySnapshot?.strategy ?? 'DEPOSIT_FIRST') ===
        'DEPOSIT_FIRST' &&
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
        artifactHash: contract.contentLockedHash,
        status: 'pending',
      },
    })
    if (existing && existing.expiresAt > new Date()) return existing
    const providerResult = await this.provider.requestSignature({
      transactionId: `contract-${contractId}-${signerRole}`,
      artifactHash: contract.contentLockedHash,
      signerId,
      signerRole,
    })
    const session = this.sessionRepository.create({
      contractId,
      signerId,
      signerRole,
      artifactHash: contract.contentLockedHash,
      providerTransactionId: providerResult.transactionId,
      status: providerResult.status,
      confirmationUrl: providerResult.confirmationUrl ?? null,
      certificateSerial: providerResult.certificateSerial ?? null,
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

  async reconcile(
    providerTransactionId: string,
    status: SmartCaSigningSession['status'],
    certificateSerial?: string
  ): Promise<SmartCaSigningSession> {
    const session = await this.sessionRepository.findOne({
      where: { providerTransactionId },
    })
    if (!session) throw new NotFoundException('SMARTCA_SESSION_NOT_FOUND')
    if (session.status === 'signed' || session.status === 'rejected')
      return session
    if (session.expiresAt <= new Date()) {
      session.status = 'expired'
    } else {
      session.status = status
      session.certificateSerial =
        certificateSerial ?? session.certificateSerial ?? null
    }
    return this.sessionRepository.save(session)
  }
}
