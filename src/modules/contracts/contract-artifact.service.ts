import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { InjectRepository as InjectTypeOrmRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Contract } from './schemas/contract.schema'
import { ContractArtifact } from './schemas/contract-artifact.schema'
import {
  CONTRACT_ARTIFACT_STORAGE,
  type ContractArtifactStorage,
} from './contract-artifact.storage'

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
    reference.artifactHash !== contract.contentLockedHash ||
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
  constructor(
    @InjectTypeOrmRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @Optional()
    @InjectTypeOrmRepository(ContractArtifact)
    private readonly artifactRepository?: Repository<ContractArtifact>,
    @Optional()
    @Inject(CONTRACT_ARTIFACT_STORAGE)
    private readonly storage?: ContractArtifactStorage
  ) {}

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
    if (!contract.contentLockedHash || !contract.contentLockedAt) {
      throw new ConflictException('CONTRACT_CONTENT_NOT_LOCKED')
    }
    if (bytes.length === 0) {
      throw new BadRequestException('CONTRACT_ARTIFACT_BYTES_MISSING')
    }
    if (!bytes.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw new BadRequestException('CONTRACT_ARTIFACT_PDF_INVALID')
    }
    const artifactHash = this.digest(bytes)
    if (artifactHash !== contract.contentLockedHash) {
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
    const templateRef = contract.termsRef ?? {
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
      contentType: saved.contentType,
      lockedAt: contract.contentLockedAt,
    }
    contract.contractHash = saved.artifactHash
    await this.contractRepository.save(contract)
    return saved
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
      artifact.contentType !== reference.contentType ||
      artifactLockedAt !== referenceLockedAt
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
    }

    const bytes = await this.storage.download(artifact.gridFsFileId)
    if (
      bytes.length !== artifact.byteLength ||
      this.digest(bytes) !== reference.artifactHash ||
      this.digest(bytes) !== contract.contentLockedHash
    ) {
      throw new ConflictException('CONTRACT_ARTIFACT_HASH_MISMATCH')
    }
    return { reference, artifact, bytes }
  }

  async generateDocument(
    contractId: string,
    actorId: string,
    isStaff: boolean,
    format: string
  ): Promise<Buffer> {
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
    return (await this.resolveCanonicalArtifact(contract)).bytes
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
