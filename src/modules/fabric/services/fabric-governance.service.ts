import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { LegalTermsService } from '../../legal/services/legal-terms.service'
import { PoliciesService } from '../../legal/services/policies.service'
import { PlatformFeesService } from '../../payments/services/platform-fees.service'
import { RentalExecutionPoliciesService } from '../../rental/services/rental-execution-policies.service'
import { ContractTemplateGovernanceService } from '../../contracts/legal/contract-template-governance.service'
import { ContractLayoutService } from '../../contracts/layout/contract-layout.service'
import { sha256Hex } from '../utils/canonical-json'
import { FabricService } from './fabric.service'
import { LedgerOutboxService } from './ledger-outbox.service'
import type { LedgerOutbox } from '../schemas/ledger-outbox.schema'
import { buildGovernanceSnapshotArgs } from '../utils/ledger-action-args'
import {
  GOVERNANCE_EVIDENCE_SCHEMA_VERSION,
  buildGovernanceEvidenceEnvelope,
  hashGovernanceEvidenceEnvelope,
} from '../utils/governance-evidence-envelope'
import {
  FabricGovernanceSnapshot,
  type FabricGovernanceSnapshotComponents,
} from '../schemas/fabric-governance-snapshot.schema'

/**
 * Denylist tường minh cho cấu hình bị coi là bí mật (D2): bị TỪ CHỐI chứ không
 * băm vào manifest, vì hash của giá trị entropy thấp vẫn dò ngược được.
 */
export const GOVERNANCE_SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /SECRET/,
  /PASSWORD|PASSWD/,
  /TOKEN/,
  /CREDENTIAL/,
  /API[_\-. ]?KEY/,
  /PRIVATE[_\-. ]?KEY/,
  /ACCESS[_\-. ]?KEY/,
  /(^|[^A-Z])SALT([^A-Z]|$)/,
  /(^|[^A-Z])DSN([^A-Z]|$)/,
]

export const GOVERNANCE_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/,
  /^Bearer\s+\S+/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i,
  /^[A-Fa-f0-9]{40,}$/,
  /^[A-Za-z0-9+/_-]{32,}={0,2}$/,
  /^AKIA[0-9A-Z]{16}$/,
  /^(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+/,
]

export type GovernanceActor = { id: string; role: string }

export type GovernancePublishResult = {
  snapshot: FabricGovernanceSnapshot
  created: boolean
}

export type GovernanceSnapshotPage = {
  items: FabricGovernanceSnapshot[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type GovernanceVerificationStatus =
  | 'verified'
  | 'mismatch'
  | 'unavailable'
  | 'not-recorded'

export type GovernanceVerification = {
  snapshotId: string
  version: number
  status: GovernanceVerificationStatus
  localManifestHash: string
  ledgerManifestHash: string | null
  mismatchFields: string[]
  txHash: string | null
  blockNumber: number | null
  networkMode: 'fabric' | 'simulation'
  reason: string | null
  checkedAt: string
}

const MAX_VERSION_RETRIES = 3
const ELIGIBLE_SNAPSHOT_SCAN_LIMIT = 100

type ExecutionPolicyReference = { policyId: string; version?: number | null }

@Injectable()
export class FabricGovernanceService {
  private readonly logger = new Logger(FabricGovernanceService.name)

  constructor(
    @InjectRepository(FabricGovernanceSnapshot)
    private readonly repository: Repository<FabricGovernanceSnapshot>,
    private readonly legalTermsService: LegalTermsService,
    private readonly policiesService: PoliciesService,
    private readonly executionPoliciesService: RentalExecutionPoliciesService,
    private readonly ledgerOutboxService: LedgerOutboxService,
    private readonly fabricService: FabricService,
    // contracts/legal + contracts/layout nằm trong ContractsModule (đã import FabricModule),
    // nên tra cứu lazy qua ModuleRef để tránh vòng phụ thuộc module.
    private readonly moduleRef: ModuleRef
  ) {}

  // ── Publish ──────────────────────────────────────────────────────────────

  async publish(actor: GovernanceActor): Promise<GovernancePublishResult> {
    const components = await this.resolveComponents()

    for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt += 1) {
      const latest = await this.findLatest()

      if (
        latest &&
        this.hashComponents(latest.snapshotCode, components) ===
          latest.manifestHash
      ) {
        // Cùng manifest với bản mới nhất → idempotent, không tạo version mới.
        await this.enqueueIfPending(latest)
        return { snapshot: latest, created: false }
      }

      const version = (latest?.version ?? 0) + 1
      const snapshotCode = `GOV-${String(version).padStart(6, '0')}`
      const manifestHash = this.hashComponents(snapshotCode, components)
      const now = new Date()

      let saved: FabricGovernanceSnapshot
      try {
        saved = await this.repository.save(
          this.repository.create({
            snapshotCode,
            version,
            manifestSchemaVersion: GOVERNANCE_EVIDENCE_SCHEMA_VERSION,
            status: 'published',
            components,
            manifestHash,
            ledgerStatus: 'pending',
            txHash: null,
            blockNumber: null,
            publishedBy: actor.id,
            publishedAt: now,
          })
        )
      } catch (error) {
        if (this.isDuplicateKey(error)) continue // bản khác vừa chiếm version → đọc lại và thử tiếp
        throw error
      }

      await this.enqueueLedgerEvidence(saved)
      this.logger.log(
        `Published governance snapshot ${snapshotCode} (v${version})`
      )
      return { snapshot: saved, created: true }
    }

    throw new UnprocessableEntityException({
      code: 'GOVERNANCE_SNAPSHOT_CONFLICT',
      message: 'Không thể cấp version mới cho governance snapshot, hãy thử lại',
    })
  }

  // ── Read model ───────────────────────────────────────────────────────────

  async list(query: {
    page: number
    limit: number
  }): Promise<GovernanceSnapshotPage> {
    const [items, total] = await this.repository.findAndCount({
      order: { version: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    })
    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    }
  }

  async getById(id: string): Promise<FabricGovernanceSnapshot> {
    const snapshot = ObjectId.isValid(id)
      ? await this.repository.findOne({ where: { _id: new ObjectId(id) } })
      : null
    if (!snapshot) {
      throw new NotFoundException({
        code: 'GOVERNANCE_SNAPSHOT_NOT_FOUND',
        message: 'Không tìm thấy governance snapshot',
      })
    }
    return snapshot
  }

  /**
   * D2: snapshot published mới nhất mà `rentalExecutionPolicy` chứa đúng policy
   * của hợp đồng (cùng version nếu hợp đồng có version). Bỏ qua snapshot đã
   * failed-terminal trên ledger.
   */
  async findLatestEligibleForExecutionPolicy(
    ref: ExecutionPolicyReference
  ): Promise<FabricGovernanceSnapshot | null> {
    const candidates = await this.repository.find({
      where: { status: 'published' },
      order: { version: 'DESC' },
      take: ELIGIBLE_SNAPSHOT_SCAN_LIMIT,
    })
    return (
      candidates.find(
        snapshot =>
          snapshot.ledgerStatus !== 'failed-terminal' &&
          (snapshot.components.rentalExecutionPolicy ?? []).some(
            policy =>
              policy.policyId === ref.policyId &&
              (ref.version == null || policy.version === ref.version)
          )
      ) ?? null
    )
  }

  // ── Verify ───────────────────────────────────────────────────────────────

  async verify(id: string): Promise<GovernanceVerification> {
    const snapshot = await this.getById(id)
    const snapshotId = snapshot._id.toHexString()
    const recomputed = this.hashComponents(
      snapshot.snapshotCode,
      snapshot.components
    )
    const base = {
      snapshotId,
      version: snapshot.version,
      localManifestHash: snapshot.manifestHash,
      ledgerManifestHash: null,
      mismatchFields: [] as string[],
      txHash: snapshot.txHash ?? null,
      blockNumber: snapshot.blockNumber ?? null,
      checkedAt: new Date().toISOString(),
    }

    if (this.fabricService.getStatus().mode === 'simulation') {
      return {
        ...base,
        status: 'unavailable',
        networkMode: 'simulation',
        reason: 'FABRIC_SIMULATION_MODE',
      }
    }

    let record: Record<string, unknown>
    try {
      const result = await this.fabricService.evaluateTransaction(
        'readGovernanceSnapshot',
        [snapshotId]
      )
      record = (
        typeof result === 'object' && result !== null ? result : {}
      ) as Record<string, unknown>
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ERR_NOT_FOUND')) {
        return {
          ...base,
          status: 'not-recorded',
          networkMode: 'fabric',
          reason: null,
        }
      }
      return {
        ...base,
        status: 'unavailable',
        networkMode: 'fabric',
        reason: message.includes('FABRIC_GATEWAY_UNAVAILABLE')
          ? 'FABRIC_UNAVAILABLE'
          : 'FABRIC_QUERY_FAILED',
      }
    }

    const ledgerManifestHash =
      typeof record.manifestHash === 'string' ? record.manifestHash : null
    const mismatchFields: string[] = []
    if (recomputed !== snapshot.manifestHash) {
      mismatchFields.push('localManifestHash')
    }
    if (ledgerManifestHash !== snapshot.manifestHash) {
      mismatchFields.push('manifestHash')
    }
    if (record.version !== snapshot.version) mismatchFields.push('version')
    if (record.manifestSchemaVersion !== snapshot.manifestSchemaVersion) {
      mismatchFields.push('manifestSchemaVersion')
    }

    return {
      ...base,
      status: mismatchFields.length === 0 ? 'verified' : 'mismatch',
      ledgerManifestHash,
      mismatchFields,
      txHash: typeof record.txId === 'string' ? record.txId : base.txHash,
      networkMode: 'fabric',
      reason: null,
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async findLatest(): Promise<FabricGovernanceSnapshot | null> {
    const [latest] = await this.repository.find({
      order: { version: 'DESC' },
      take: 1,
    })
    return latest ?? null
  }

  private hashComponents(
    snapshotCode: string,
    components: FabricGovernanceSnapshotComponents
  ): string {
    return hashGovernanceEvidenceEnvelope(
      buildGovernanceEvidenceEnvelope({ snapshotCode, components })
    )
  }

  private async enqueueIfPending(
    snapshot: FabricGovernanceSnapshot
  ): Promise<void> {
    // enqueue() idempotent theo (aggregateType, aggregateId, eventType): tự chữa
    // trường hợp lần publish trước lưu snapshot xong nhưng enqueue bị lỗi.
    if (snapshot.ledgerStatus === 'pending') {
      await this.enqueueLedgerEvidence(snapshot)
    }
  }

  /**
   * PROP-399 D7 (repair): tạo lại đúng một outbox item governance.published cho snapshot đã
   * published. Idempotent theo khoá outbox; trả null khi snapshot không còn tồn tại/hợp lệ.
   */
  async ensureLedgerEvidenceQueued(
    snapshotId: string
  ): Promise<LedgerOutbox | null> {
    const snapshot = ObjectId.isValid(snapshotId)
      ? await this.repository.findOne({
          where: { _id: new ObjectId(snapshotId) },
        })
      : null
    if (!snapshot || snapshot.status !== 'published') return null
    return this.enqueueLedgerEvidence(snapshot)
  }

  private async enqueueLedgerEvidence(
    snapshot: FabricGovernanceSnapshot
  ): Promise<LedgerOutbox> {
    const snapshotId = snapshot._id.toHexString()
    // Chỉ metadata an toàn riêng tư — không giá trị policy, văn bản điều khoản hay PII.
    return this.ledgerOutboxService.enqueue({
      aggregateType: 'governance-snapshot',
      aggregateId: snapshotId,
      eventType: 'governance.published',
      action: 'publishGovernanceSnapshot',
      args: buildGovernanceSnapshotArgs({
        snapshotId,
        version: snapshot.version,
        manifestHash: snapshot.manifestHash,
        manifestSchemaVersion: snapshot.manifestSchemaVersion,
      }),
      metadata: {
        governanceSnapshotId: snapshotId,
        details: {
          snapshotCode: snapshot.snapshotCode,
          version: snapshot.version,
          manifestHash: snapshot.manifestHash,
        },
      },
    })
  }

  private isDuplicateKey(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false
    const candidate = error as { code?: unknown; message?: unknown }
    return (
      candidate.code === 11000 ||
      (typeof candidate.message === 'string' &&
        candidate.message.includes('E11000'))
    )
  }

  private async resolveComponents(): Promise<FabricGovernanceSnapshotComponents> {
    const missing: string[] = []

    const terms = await this.legalTermsService
      .getCurrentPublishedTerms()
      .catch(() => null)
    const legalTerms = terms
      ? [{ id: terms.key, version: terms.version, hash: terms.contentHash }]
      : []
    if (legalTerms.length === 0) missing.push('legalTerms')

    const activePolicies = (await this.policiesService.findAll()).filter(
      policy => policy.status === 'active'
    )
    this.assertNoSecretPolicies(activePolicies)
    const policySet = activePolicies
      .map(policy => {
        const unit = policy.unit ?? null
        return {
          key: policy.key,
          value: policy.value,
          unit,
          hash: sha256Hex({ key: policy.key, value: policy.value, unit }),
        }
      })
      .sort((a, b) => a.key.localeCompare(b.key))
    if (policySet.length === 0) missing.push('policySet')

    const templates = await this.moduleRef
      .get(ContractTemplateGovernanceService, { strict: false })
      .listLatestPublished()
    const contractTemplate = templates.map(template => ({
      id: template.templateKey,
      version: template.version,
      hash: template.contentHash,
    }))
    if (contractTemplate.length === 0) missing.push('contractTemplate')

    const layouts = await this.moduleRef
      .get(ContractLayoutService, { strict: false })
      .listLatestPublished()
    const contractLayout =
      layouts.length === 0
        ? null
        : layouts.map(layout => ({
            id: layout.profileKey,
            version: layout.version,
            hash: layout.contentHash,
          }))

    const executionPolicies = await this.executionPoliciesService.listActive()
    const rentalExecutionPolicy: FabricGovernanceSnapshotComponents['rentalExecutionPolicy'] =
      []
    for (const policy of executionPolicies) {
      if (policy.version == null || !policy.contentHash) {
        missing.push('rentalExecutionPolicy')
        break
      }
      rentalExecutionPolicy.push({
        policyId: policy.policyId,
        version: policy.version,
        hash: policy.contentHash,
      })
    }
    rentalExecutionPolicy.sort(
      (a, b) => a.policyId.localeCompare(b.policyId) || a.version - b.version
    )
    if (executionPolicies.length === 0) missing.push('rentalExecutionPolicy')

    // platform-fees nằm trong PaymentsModule, không được fabric.module.ts
    // import trực tiếp (né vòng) → tra cứu lazy qua ModuleRef. Khác với
    // ContractTemplateGovernanceService/ContractLayoutService ở trên,
    // provider này KHÔNG được coi là optional: publish governance mà thiếu
    // phí sàn là lỗi cấu hình (wiring), phải ném lỗi rõ ràng, không âm thầm
    // bỏ qua.
    const platformFeesService = this.moduleRef.get(PlatformFeesService, {
      strict: false,
    })
    if (!platformFeesService) {
      throw new UnprocessableEntityException({
        code: 'GOVERNANCE_PLATFORM_FEES_UNAVAILABLE',
        message:
          'PlatformFeesService không resolve được qua ModuleRef; không thể publish governance snapshot',
      })
    }
    const schedule = await platformFeesService.getEffectiveSchedule()
    let feeSchedule: FabricGovernanceSnapshotComponents['feeSchedule'] = null
    if (schedule) {
      if (!schedule.contentHash) missing.push('feeSchedule')
      else {
        feeSchedule = {
          id: schedule.scheduleId,
          version: schedule.version,
          hash: schedule.contentHash,
        }
      }
    }

    if (missing.length > 0) this.throwIncomplete(missing)

    const components: FabricGovernanceSnapshotComponents = {
      legalTerms: legalTerms.sort(
        (a, b) => a.id.localeCompare(b.id) || a.version - b.version
      ),
      policySet,
      contractTemplate: contractTemplate.sort(
        (a, b) => a.id.localeCompare(b.id) || a.version - b.version
      ),
      contractLayout: contractLayout
        ? contractLayout.sort(
            (a, b) => a.id.localeCompare(b.id) || a.version - b.version
          )
        : null,
      rentalExecutionPolicy,
      feeSchedule,
    }

    try {
      // Kiểm chứng toàn bộ hash của nguồn có thể băm chuẩn hoá (ném khi hash sai dạng).
      buildGovernanceEvidenceEnvelope({
        snapshotCode: 'GOV-VALIDATE',
        components,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.throwIncomplete([], reason.split(':')[0])
    }
    return components
  }

  private throwIncomplete(missing: string[], reason?: string): never {
    throw new UnprocessableEntityException({
      code: 'GOVERNANCE_SNAPSHOT_INCOMPLETE',
      message:
        'Governance snapshot chưa đầy đủ: thiếu, không còn hiệu lực hoặc không thể băm chuẩn hoá',
      missing: [...new Set(missing)],
      ...(reason ? { reason } : {}),
    })
  }

  private assertNoSecretPolicies(
    policies: Array<{ key: string; value: string }>
  ): void {
    const flagged = policies
      .filter(policy => this.looksSecret(policy.key, policy.value))
      .map(policy => policy.key)
    if (flagged.length > 0) {
      // Chỉ trả về KEY — không bao giờ echo giá trị bị nghi là bí mật.
      throw new UnprocessableEntityException({
        code: 'GOVERNANCE_SECRET_CLASSIFIED',
        message:
          'Cấu hình bị phân loại là bí mật không được đưa vào governance snapshot',
        policyKeys: flagged,
      })
    }
  }

  private looksSecret(key: string, value: string): boolean {
    const upperKey = key.toUpperCase()
    const strippedKey = upperKey.replace(/[^A-Z0-9]/g, '')
    if (
      GOVERNANCE_SECRET_KEY_PATTERNS.some(
        pattern => pattern.test(upperKey) || pattern.test(strippedKey)
      )
    ) {
      return true
    }
    const text = String(value ?? '').trim()
    return GOVERNANCE_SECRET_VALUE_PATTERNS.some(pattern => pattern.test(text))
  }
}
