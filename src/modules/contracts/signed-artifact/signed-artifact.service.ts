import { createHash } from 'node:crypto'
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ContractArtifactService } from '../services/contract-artifact.service'
import {
  CONTRACT_ARTIFACT_STORAGE,
  type ContractArtifactStorage,
} from '../services/contract-artifact.storage'
import { Contract } from '../schemas/contract.schema'
import {
  ContractDocument,
  type SignedContractDocument,
} from '../schemas/contract-document.schema'
import { buildSignableBase } from './signature-fields'
import {
  embedPadesSignature,
  preparePadesSigning,
  type PadesSignatureMeta,
} from './pades.util'

export type PrepareSignedArtifactInput = {
  contract: Contract
  signerId: string
  signerRole: 'tenant' | 'landlord'
  signerPem: string
  chainPem: string[]
  /** Họ tên và serial chứng thư hiển thị trong khung "Đã xác thực SmartCA". */
  signerName: string
  certificateSerial: string
}

export type PreparedSignedArtifact = {
  id: string
  /** Digest của signedAttributes: giá trị SmartCA phải ký (data_to_be_signed). */
  signedAttrsDigest: string
}

export type SignedArtifactDownload = {
  bytes: Buffer
  sha256: string
  revision: number
  canonicalHash: string
}

/** Chỉ dùng với VNPT thật: provider mock/dev không bao giờ tạo PAdES giả. */
export function isPadesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env['SMARTCA_PADES_ENABLED'] === 'true' &&
    (env['SMARTCA_ENV'] ?? 'production').toLowerCase() !== 'mock'
  )
}

function signatureMeta(): PadesSignatureMeta {
  return {
    reason: process.env['SMARTCA_PADES_REASON'] ?? 'Ký hợp đồng thuê căn hộ',
    location: process.env['SMARTCA_PADES_LOCATION'] ?? 'Việt Nam',
    contactInfo:
      process.env['SMARTCA_PADES_CONTACT'] ?? 'support@th-proptech.vn',
    creator: process.env['SMARTCA_PADES_CREATOR'] ?? 'TH-PropTech',
  }
}

@Injectable()
export class SignedArtifactService {
  private readonly logger = new Logger(SignedArtifactService.name)

  constructor(
    @InjectRepository(ContractDocument)
    private readonly repository: Repository<ContractDocument>,
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @Inject(CONTRACT_ARTIFACT_STORAGE)
    private readonly storage: ContractArtifactStorage,
    private readonly artifactService: ContractArtifactService
  ) {}

  isEnabled(): boolean {
    return isPadesEnabled()
  }

  /**
   * Chuẩn bị bản ký: lấy nền là bản đã ký gần nhất (bên kia đã ký) hoặc canonical,
   * thêm placeholder, trả digest để SmartCA ký. Canonical bytes không bị sửa.
   */
  async prepare(
    input: PrepareSignedArtifactInput
  ): Promise<PreparedSignedArtifact> {
    const contractId = input.contract._id.toHexString()
    const canonical = await this.artifactService.resolveCanonicalArtifact(
      input.contract
    )
    const latest = await this.findLatestReady(contractId)
    // Lần ký đầu dựng bản nền có hai trường chữ ký đặt đúng ô chữ ký; các lần sau nối thêm lên bản đã ký trước.
    const base = latest
      ? await this.readSigned(latest)
      : ((await buildSignableBase(canonical.bytes)) ?? canonical.bytes)

    const prepared = preparePadesSigning(
      base,
      signatureMeta(),
      input.signerPem,
      input.chainPem,
      new Date(),
      {
        role: input.signerRole,
        signerName: input.signerName,
        certificateSerial: input.certificateSerial,
      }
    )
    const preparedFileId = await this.storage.upload(
      prepared.pdf,
      `contract-${contractId}-signed-prepared.pdf`
    )
    const record = this.repository.create({
      kind: 'signed',
      contractId,
      signerId: input.signerId,
      signerRole: input.signerRole,
      canonicalHash: canonical.reference.artifactHash,
      revision: (latest?.revision ?? 0) + 1,
      status: 'prepared',
      errorCode: null,
      sessionId: null,
      preparedFileId,
      contentDigest: prepared.contentDigestHex,
      signedAttrsDigest: prepared.signedAttrsDigestHex,
      signingTime: prepared.signingTime,
      signerPem: input.signerPem,
      chainPem: input.chainPem,
      sha256: null,
      byteLength: null,
    })
    const saved = await this.repository.save(record)
    return {
      id: saved._id.toHexString(),
      signedAttrsDigest: prepared.signedAttrsDigestHex,
    }
  }

  async attachSession(id: string, sessionId: string): Promise<void> {
    const record = await this.findById(id)
    if (!record) return
    record.sessionId = sessionId
    await this.repository.save(record)
  }

  /** Nhúng chữ ký SmartCA vào bản đã chuẩn bị. Lỗi được ghi lại, không ném ra ngoài. */
  async finalize(id: string, signatureBase64: string): Promise<boolean> {
    const record = await this.findById(id)
    if (!record) return false
    try {
      const pdf = await this.storage.download(record.preparedFileId)
      const signed = embedPadesSignature(
        {
          pdf,
          contentDigestHex: record.contentDigest,
          signedAttrsDigestHex: record.signedAttrsDigest,
          signingTime: record.signingTime,
        },
        signatureBase64,
        record.signerPem,
        record.chainPem
      )
      const signedFileId = await this.storage.upload(
        signed,
        `contract-${record.contractId}-signed-r${record.revision}.pdf`
      )
      record.signedFileId = signedFileId
      record.sha256 = createHash('sha256').update(signed).digest('hex')
      record.byteLength = signed.length
      record.status = 'ready'
      record.errorCode = null
      await this.repository.save(record)
      return true
    } catch (error) {
      record.status = 'failed'
      record.errorCode =
        error instanceof Error && /^PADES_[A-Z_]+$/.test(error.message)
          ? error.message
          : 'SIGNED_ARTIFACT_EMBED_FAILED'
      await this.repository.save(record)
      this.logger.warn(
        `Signed artifact embed failed id=${id} code=${record.errorCode}`
      )
      return false
    }
  }

  async markFailed(id: string, errorCode: string): Promise<void> {
    const record = await this.findById(id)
    if (!record || record.status === 'ready') return
    record.status = 'failed'
    record.errorCode = errorCode
    await this.repository.save(record)
  }

  /** Chỉ participant của contract hoặc staff/admin được tải bản đã ký. */
  async downloadForActor(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<SignedArtifactDownload> {
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
      throw new ForbiddenException('CONTRACT_ACCESS_DENIED')
    }
    return this.download(contractId)
  }

  async download(contractId: string): Promise<SignedArtifactDownload> {
    const latest = await this.findLatestReady(contractId)
    if (!latest) throw new NotFoundException('SIGNED_ARTIFACT_NOT_FOUND')
    const bytes = await this.readSigned(latest)
    return {
      bytes,
      sha256: latest.sha256 ?? '',
      revision: latest.revision,
      canonicalHash: latest.canonicalHash,
    }
  }

  private async readSigned(record: SignedContractDocument): Promise<Buffer> {
    if (!record.signedFileId) {
      throw new ServiceUnavailableException('SIGNED_ARTIFACT_UNAVAILABLE')
    }
    const bytes = await this.storage.download(record.signedFileId)
    if (
      record.sha256 &&
      createHash('sha256').update(bytes).digest('hex') !== record.sha256
    ) {
      throw new ServiceUnavailableException('SIGNED_ARTIFACT_INTEGRITY_ERROR')
    }
    return bytes
  }

  private async findLatestReady(
    contractId: string
  ): Promise<SignedContractDocument | null> {
    const ready = (await this.repository.find({
      where: { kind: 'signed', contractId, status: 'ready' },
    })) as SignedContractDocument[]
    return ready.reduce<SignedContractDocument | null>(
      (best, item) => (!best || item.revision > best.revision ? item : best),
      null
    )
  }

  private async findById(id: string): Promise<SignedContractDocument | null> {
    if (!ObjectId.isValid(id)) return null
    return (await this.repository.findOne({
      where: { _id: new ObjectId(id), kind: 'signed' },
    })) as SignedContractDocument | null
  }
}
