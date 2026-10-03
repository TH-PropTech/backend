import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { InjectRepository as InjectTypeOrmRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from './schemas/contract.schema'
import { ContractAmendment } from './schemas/contract-amendment.schema'
import { ContractArtifact } from './schemas/contract-artifact.schema'
import { evaluateLockArtifact } from './flow/flow-guards'
import {
  CONTRACT_ARTIFACT_STORAGE,
  type ContractArtifactStorage,
} from './contract-artifact.storage'
import { RentalTransactionEventService } from '../rental-transactions/rental-transaction-event.service'

export type ContractArtifactFormat = 'pdf' | 'docx'

export type CanonicalArtifactReference = NonNullable<Contract['artifactRef']>

export type CanonicalArtifactResolution = {
  reference: CanonicalArtifactReference
  artifact: ContractArtifact
  bytes: Buffer
}

export function requireCanonicalArtifactReference(
  contract: Pick<
    Contract,
    'artifactRef' | 'contentLockedHash' | 'contentLockedAt'
  >
): CanonicalArtifactReference {
  const reference = contract.artifactRef
  if (!reference || !contract.contentLockedHash || !contract.contentLockedAt) {
    throw new ConflictException('CONTRACT_ARTIFACT_NOT_LOCKED')
  }
  if (
    reference.contentType !== 'application/pdf' ||
    (reference.canonicalContentHash
      ? reference.canonicalContentHash !== contract.contentLockedHash
      : reference.artifactHash !== contract.contentLockedHash) ||
    reference.revision < 1 ||
    !reference.artifactId
  ) {
    throw new ConflictException('CONTRACT_ARTIFACT_HASH_MISMATCH')
  }
  return reference
}

export interface ContractArtifactRenderer {
  render(contract: Contract, format: ContractArtifactFormat): Promise<Buffer>
}

@Injectable()
export class ContractArtifactService {
  private readonly logger = new Logger(ContractArtifactService.name)

  constructor(
    @InjectTypeOrmRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @Optional()
    @InjectTypeOrmRepository(ContractArtifact)
    private readonly artifactRepository?: Repository<ContractArtifact>,
    @Optional()
    @Inject(CONTRACT_ARTIFACT_STORAGE)
    private readonly storage?: ContractArtifactStorage,
    @Optional()
    @InjectTypeOrmRepository(ContractAmendment)
    private readonly amendmentRepository?: Repository<ContractAmendment>,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  async lockAmendmentArtifact(
    contractId: string,
    amendmentId: string,
    actorId: string,
    isStaff: boolean,
    bytes: Buffer
  ): Promise<ContractAmendment> {
    const contract = await this.findAuthorizedContract(
      contractId,
      actorId,
      isStaff
    )
    if (!this.amendmentRepository || !ObjectId.isValid(amendmentId)) {
      throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    }
    const amendment = await this.amendmentRepository.findOne({
      where: { _id: new ObjectId(amendmentId), contractId },
    })
    if (!amendment) throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    if (amendment.status !== 'locked') {
      if (amendment.artifactRef) return amendment
      throw new ConflictException('CONTRACT_AMENDMENT_NOT_ARTIFACT_LOCKABLE')
    }
    if (!amendment.contentHash) {
      throw new ConflictException('CONTRACT_AMENDMENT_CANONICAL_HASH_MISSING')
    }
    if (bytes.length === 0) {
      throw new BadRequestException('CONTRACT_ARTIFACT_BYTES_MISSING')
    }
    if (!bytes.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw new BadRequestException('CONTRACT_ARTIFACT_PDF_INVALID')
    }
    if (!this.artifactRepository || !this.storage) {
      throw new ServiceUnavailableException(
        'CONTRACT_ARTIFACT_STORAGE_UNAVAILABLE'
      )
    }

    const artifactHash = this.digest(bytes)
    const gridFsFileId = await this.storage.upload(
      bytes,
      `${contract.contractCode}-amendment-${amendment.sequence}-r${amendment.revision}.pdf`
    )
    const templateRef = contract.contractTemplateRef ??
      contract.termsRef ?? {
        key: 'legacy-contract-template',
        version: 1,
        contentHash: contract.contentLockedHash ?? amendment.contentHash,
      }
    const artifact = await this.artifactRepository.save(
      this.artifactRepository.create({
        contractId,
        amendmentId,
        revision: amendment.revision + 1,
        templateRef,
        legalProfile:
          contract.flowProfileRef?.profileId ?? 'PRIVATE_CIVIL_APARTMENT_LEASE',
        gridFsFileId,
        artifactHash,
        canonicalContentHash: amendment.contentHash,
        rendererVersion: 'uploaded-amendment-pdf-v1',
        sourceSchemaVersion: contract.hashSchemaVersion ?? 2,
        byteLength: bytes.length,
        contentType: 'application/pdf',
        lockedAt: new Date(),
      })
    )
    amendment.artifactId = artifact._id.toHexString()
    amendment.artifactHash = artifactHash
    amendment.artifactRef = {
      artifactId: artifact._id.toHexString(),
      revision: artifact.revision,
      artifactHash,
      canonicalContentHash: amendment.contentHash,
      rendererVersion: artifact.rendererVersion ?? 'uploaded-amendment-pdf-v1',
      sourceSchemaVersion: artifact.sourceSchemaVersion ?? 2,
      byteLength: bytes.length,
      contentType: 'application/pdf',
      lockedAt: artifact.lockedAt ?? new Date(),
    }
    amendment.status = 'pending-signature'
    amendment.revision += 1
    return this.amendmentRepository.save(amendment)
  }

  async resolveAmendmentArtifact(
    contractId: string,
    amendmentId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<{ bytes: Buffer; artifactHash: string; revision: number }> {
    const contract = await this.findAuthorizedContract(
      contractId,
      actorId,
      isStaff
    )
    if (!this.amendmentRepository || !ObjectId.isValid(amendmentId)) {
      throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    }
    const amendment = await this.amendmentRepository.findOne({
      where: { _id: new ObjectId(amendmentId), contractId },
    })
    if (!amendment?.artifactRef || !this.artifactRepository || !this.storage) {
      throw new ConflictException('CONTRACT_AMENDMENT_ARTIFACT_NOT_AVAILABLE')
    }
    const artifact = await this.findArtifact(amendment.artifactRef.artifactId)
    if (
      !artifact ||
      artifact.contractId !== contract._id.toHexString() ||
      artifact.amendmentId !== amendmentId ||
      artifact.revision !== amendment.artifactRef.revision ||
      artifact.artifactHash !== amendment.artifactRef.artifactHash ||
      artifact.canonicalContentHash !== amendment.contentHash
    ) {
      throw new ConflictException('CONTRACT_AMENDMENT_ARTIFACT_HASH_MISMATCH')
    }
    const bytes = await this.storage.download(artifact.gridFsFileId)
    if (
      bytes.length !== artifact.byteLength ||
      this.digest(bytes) !== artifact.artifactHash
    ) {
      throw new ConflictException('CONTRACT_AMENDMENT_ARTIFACT_HASH_MISMATCH')
    }
    return {
      bytes,
      artifactHash: artifact.artifactHash,
      revision: artifact.revision,
    }
  }

  async lockCanonicalArtifact(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    bytes: Buffer
  ): Promise<ContractArtifact> {
    const contract = await this.findAuthorizedContract(
      contractId,
      actorId,
      isStaff
    )
    if (contract.artifactRef) {
      if (this.digest(bytes) !== contract.artifactRef.artifactHash) {
        throw new ConflictException('CONTRACT_ARTIFACT_IMMUTABLE')
      }
      const resolved = await this.resolveCanonicalArtifact(contract)
      return resolved.artifact
    }
    const artifactGuard = evaluateLockArtifact({
      isContentLocked: Boolean(
        contract.contentLockedHash && contract.contentLockedAt
      ),
      hasArtifact: false,
    })
    // Kiểm tra lại từng trường để TypeScript thu hẹp kiểu cho đoạn ghi bên dưới.
    if (
      !artifactGuard.enabled ||
      !contract.contentLockedHash ||
      !contract.contentLockedAt
    ) {
      throw new ConflictException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    if (bytes.length === 0) {
      throw new BadRequestException('CONTRACT_ARTIFACT_BYTES_MISSING')
    }
    if (!bytes.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw new BadRequestException('CONTRACT_ARTIFACT_PDF_INVALID')
    }
    const artifactHash = this.digest(bytes)
    if (
      contract.hashSchemaVersion !== 2 &&
      artifactHash !== contract.contentLockedHash
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_HASH_MISMATCH')
    }
    if (!this.artifactRepository || !this.storage) {
      throw new ServiceUnavailableException(
        'CONTRACT_ARTIFACT_STORAGE_UNAVAILABLE'
      )
    }

    const gridFsFileId = await this.storage.upload(
      bytes,
      `${contract.contractCode}-r${contract.contentRevision ?? 1}.pdf`
    )
    const templateRef = contract.contractTemplateRef ??
      contract.termsRef ?? {
        key: 'legacy-contract-template',
        version: 1,
        contentHash: contract.contentLockedHash,
      }
    const artifact = this.artifactRepository.create({
      contractId,
      revision: contract.contentRevision ?? 1,
      templateRef,
      legalProfile:
        contract.flowProfileRef?.profileId ?? 'PRIVATE_CIVIL_APARTMENT_LEASE',
      gridFsFileId,
      artifactHash,
      byteLength: bytes.length,
      canonicalContentHash: contract.contentLockedHash,
      rendererVersion: 'uploaded-canonical-pdf-v1',
      sourceSchemaVersion: contract.hashSchemaVersion ?? 1,
      contentType: 'application/pdf',
      lockedAt: contract.contentLockedAt,
    })
    const saved = await this.artifactRepository.save(artifact)
    contract.artifactRef = {
      artifactId: saved._id.toHexString(),
      revision: saved.revision,
      templateKey: saved.templateRef.key,
      templateVersion: saved.templateRef.version,
      hashSchemaVersion: contract.hashSchemaVersion ?? 1,
      artifactHash: saved.artifactHash,
      canonicalContentHash:
        saved.canonicalContentHash ?? contract.contentLockedHash,
      rendererVersion: saved.rendererVersion ?? null,
      sourceSchemaVersion:
        saved.sourceSchemaVersion ?? contract.hashSchemaVersion ?? 1,
      byteLength: saved.byteLength,
      amendmentId: saved.amendmentId ?? null,
      contentType: saved.contentType,
      lockedAt: contract.contentLockedAt,
    }
    contract.contractHash = saved.artifactHash
    await this.contractRepository.save(contract)
    await this.recordTransactionEvent({
      contractId,
      eventType: 'contract.artifact-locked',
      actorRole: isStaff ? 'staff' : 'landlord',
      actorId,
      transitionKey: `contract:${contractId}:artifact-locked`,
    })
    return saved
  }

  private async recordTransactionEvent(input: {
    contractId: string
    eventType: string
    actorRole: 'tenant' | 'landlord' | 'staff' | 'admin' | 'system' | 'provider'
    actorId?: string | null
    transitionKey: string
  }): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: input.contractId,
        contractId: input.contractId,
        eventType: input.eventType,
        actorRole: input.actorRole,
        actorId: input.actorId ?? null,
        refs: { contractId: input.contractId },
        transitionKey: input.transitionKey,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Rental transaction audit failed for contract artifact [${input.contractId}] event [${input.eventType}]: ${message}`
      )
    }
  }

  async resolveCanonicalArtifact(
    contract: Contract
  ): Promise<CanonicalArtifactResolution> {
    const reference = requireCanonicalArtifactReference(contract)
    if (!this.artifactRepository || !this.storage) {
      throw new ServiceUnavailableException(
        'CONTRACT_ARTIFACT_STORAGE_UNAVAILABLE'
      )
    }

    const artifact = await this.findArtifact(reference.artifactId)
    if (!artifact) throw new NotFoundException('CONTRACT_ARTIFACT_NOT_FOUND')
    const artifactLockedAt = artifact.lockedAt
      ? new Date(artifact.lockedAt).getTime()
      : null
    const referenceLockedAt = new Date(reference.lockedAt).getTime()
    if (
      artifact.contractId !== contract._id.toHexString() ||
      artifact.revision !== reference.revision ||
      artifact.artifactHash !== reference.artifactHash ||
      (reference.canonicalContentHash &&
        artifact.canonicalContentHash &&
        artifact.canonicalContentHash !== reference.canonicalContentHash) ||
      artifact.contentType !== reference.contentType ||
      artifactLockedAt !== referenceLockedAt
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
    }

    const bytes = await this.storage.download(artifact.gridFsFileId)
    if (
      bytes.length !== artifact.byteLength ||
      this.digest(bytes) !== reference.artifactHash ||
      (reference.canonicalContentHash
        ? reference.canonicalContentHash !== contract.contentLockedHash
        : this.digest(bytes) !== contract.contentLockedHash)
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_HASH_MISMATCH')
    }
    return { reference, artifact, bytes }
  }

  /**
   * PROP-399 D8: mở artifact ký chuẩn dạng stream cho gói bằng chứng. Chỉ kiểm tra metadata
   * (tham chiếu ↔ bản ghi artifact); KHÔNG đọc bytes vào bộ nhớ — việc băm/đối chiếu bytes do
   * lớp streaming thực hiện. `revision` vắng mặt = artifact hiện hành của hợp đồng.
   */
  async openCanonicalArtifactForExport(
    contract: Contract,
    revision?: number
  ): Promise<{
    artifact: ContractArtifact
    recordedHash: string
    open: () => Promise<Readable>
  }> {
    const storage = this.storage
    if (!this.artifactRepository || !storage?.openDownloadStream) {
      throw new ServiceUnavailableException(
        'CONTRACT_ARTIFACT_STORAGE_UNAVAILABLE'
      )
    }
    const openStream = storage.openDownloadStream.bind(storage)
    const contractId = contract._id.toHexString()
    const current = contract.artifactRef
    let artifact: ContractArtifact | null

    if (revision === undefined || (current && revision === current.revision)) {
      const reference = requireCanonicalArtifactReference(contract)
      artifact = await this.findArtifact(reference.artifactId)
      if (!artifact) throw new NotFoundException('CONTRACT_ARTIFACT_NOT_FOUND')
      if (
        artifact.contractId !== contractId ||
        artifact.revision !== reference.revision ||
        artifact.artifactHash !== reference.artifactHash ||
        artifact.contentType !== reference.contentType
      ) {
        throw new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
      }
    } else {
      const candidates = await this.artifactRepository.find({
        where: { contractId, revision },
      })
      // Chỉ bản canonical của hợp đồng (bản sửa đổi có amendmentId không thuộc gói này).
      artifact = candidates.find(candidate => !candidate.amendmentId) ?? null
      if (!artifact) {
        throw new NotFoundException({
          code: 'EVIDENCE_VERSION_NOT_FOUND',
          message: 'Không tìm thấy phiên bản artifact được yêu cầu',
        })
      }
    }

    const fileId = artifact.gridFsFileId
    return {
      artifact,
      recordedHash: artifact.artifactHash,
      open: () => openStream(fileId),
    }
  }

  async generateDocument(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    format: string
  ): Promise<Buffer> {
    return (
      await this.generateDocumentWithMetadata(
        contractId,
        actorId,
        isStaff,
        format
      )
    ).bytes
  }

  async generateDocumentWithMetadata(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    format: string
  ): Promise<{ bytes: Buffer; reference: CanonicalArtifactReference }> {
    if (format !== 'pdf' && format !== 'docx') {
      throw new BadRequestException('CONTRACT_ARTIFACT_FORMAT_INVALID')
    }
    const contract = await this.findAuthorizedContract(
      contractId,
      actorId,
      isStaff
    )
    if (!contract.contentLockedHash || !contract.contentLockedAt) {
      throw new ConflictException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    if (format === 'docx') {
      throw new ServiceUnavailableException('ARTIFACT_RENDERER_NOT_CONFIGURED')
    }
    if (!contract.artifactRef) {
      throw new ServiceUnavailableException('ARTIFACT_RENDERER_NOT_CONFIGURED')
    }
    const resolved = await this.resolveCanonicalArtifact(contract)
    return { bytes: resolved.bytes, reference: resolved.reference }
  }

  private async findAuthorizedContract(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<Contract> {
    if (!ObjectId.isValid(contractId)) {
      throw new NotFoundException('CONTRACT_NOT_FOUND')
    }
    const contract = await this.contractRepository.findOne({
      where: { _id: new ObjectId(contractId) },
    })
    if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
    if (
      !isStaff &&
      contract.tenantId !== actorId &&
      contract.landlordId !== actorId
    ) {
      throw new ForbiddenException('CONTRACT_ARTIFACT_ACCESS_DENIED')
    }
    return contract
  }

  private async findArtifact(
    artifactId: string
  ): Promise<ContractArtifact | null> {
    if (!this.artifactRepository || !ObjectId.isValid(artifactId)) return null
    return this.artifactRepository.findOne({
      where: { _id: new ObjectId(artifactId) },
    })
  }

  private digest(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex')
  }
}
