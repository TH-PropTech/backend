import { createHash } from 'node:crypto'
import { Transform, type Readable, type Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
// archiver@8 là ESM-only: runtime Node ≥ 22.12 nạp bằng require(esm); Jest dùng transform riêng (jest.config.cjs).
// Chỉ dùng append(string|stream) + finalize — KHÔNG gọi glob()/directory()/file() (không đụng filesystem).
import { ZipArchive } from 'archiver'
import { HttpException } from '@nestjs/common'
import {
  ConflictException,
  Injectable,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { sha256Hex, stableStringify } from '../../fabric/utils/canonical-json'

/**
 * PROP-399 D8 (tasks 9.2/9.3): bộ dựng manifest bằng chứng hợp đồng. Thuần, xác định và không
 * chạm I/O: nhận dữ liệu đã được các service hiện có (artifact, ledger evidence, settlement…)
 * tải/ủy quyền, trả về kế hoạch đóng gói có thứ tự (descriptor nguồn: artifact GridFS hoặc nội
 * dung JSON) để lớp streaming ZIP (9.4–9.6) tiêu thụ sau — không tạo ZIP ở đây.
 */

export const EVIDENCE_PACKAGE_MANIFEST_VERSION = 1 as const
const DEFAULT_MAX_FILES = 50
const DEFAULT_MAX_BYTES = 104_857_600

export type EvidenceViewerRole = 'tenant' | 'landlord' | 'staff' | 'admin'
export type EvidenceVerificationStatus = 'verified' | 'mismatch' | 'unavailable'

type Dict = Record<string, unknown>

export type EvidencePackageInput = {
  contract: { id: string; contractCode?: string | null; status?: string | null }
  viewer: { role: EvidenceViewerRole }
  /** Artifact ký chuẩn; null hoặc 0 byte = không tải được → EVIDENCE_PACKAGE_INCOMPLETE. */
  artifact: {
    artifactId: string
    revision: number
    contentType: 'application/pdf'
    byteLength: number
    recordedHash: string
    /** SHA-256 của bytes đang lưu (do lớp đọc cung cấp); null = chưa tính được. */
    computedHash: string | null
  } | null
  ledgerEvents: Dict[]
  governance:
    | ({
        snapshotId: string
        snapshotCode?: string | null
        version: number
        manifestHash: string
        components?: Dict
      } & Dict)
    | null
  deposit?: Dict | null
  payments?: Dict[] | null
  amendments?: Dict[] | null
  termination?: Dict | null
  settlement?: Dict | null
  handover?: Dict | null
  projection: { expectedHash: string | null; projectedHash: string | null }
  ledger: {
    status: EvidenceVerificationStatus
    networkMode: 'fabric' | 'simulation'
    /** Mã lý do ổn định khi ledger không xác minh được (vd. LEDGER_NOT_RECORDED). */
    reason?: string | null
  }
  generatedAt?: Date
}

export type EvidencePackageEntry = {
  path: string
  category: string
  mediaType: string
  byteLength: number
  sha256: string
  source:
    | { type: 'artifact'; artifactId: string; revision: number }
    | { type: 'json'; content: string }
}

export type EvidenceVerificationLayer = {
  status: EvidenceVerificationStatus
  reason: string | null
}

export type EvidenceVerificationReport = {
  database: EvidenceVerificationLayer
  projection: EvidenceVerificationLayer
  ledger: EvidenceVerificationLayer
  endToEnd: boolean
}

type CategoryName =
  | 'ledgerEvents'
  | 'governance'
  | 'deposit'
  | 'payments'
  | 'amendments'
  | 'termination'
  | 'settlement'
  | 'handover'

export type EvidencePackageManifest = {
  manifestVersion: typeof EVIDENCE_PACKAGE_MANIFEST_VERSION
  /** Hash logic (loại trừ generatedAt, audience, metadata ZIP) — bằng chứng di động của gói. */
  packageHash: string
  generatedAt: string
  audience: 'participant' | 'operator'
  contract: {
    id: string
    contractCode: string | null
    artifactId: string
    artifactRevision: number
  }
  entries: Array<
    Pick<
      EvidencePackageEntry,
      'path' | 'category' | 'mediaType' | 'byteLength' | 'sha256'
    >
  >
  categories: Record<CategoryName, { present: boolean; entry: string | null }>
  ledgerEventSummary: { total: number; byEventType: Record<string, number> }
  governanceSnapshot: {
    snapshotId: string
    version: number
    manifestHash: string
  } | null
  verification: EvidenceVerificationReport
}

export type EvidencePackagePlan = {
  manifest: EvidencePackageManifest
  manifestJson: string
  packageHash: string
  verification: EvidenceVerificationReport
  /** Các entry có hash logic, theo thứ tự D8, KHÔNG gồm manifest.json. */
  entries: EvidencePackageEntry[]
  /** manifest.json đứng đầu, theo sau là `entries` — thứ tự ghi vào gói. */
  orderedEntries(): EvidencePackageEntry[]
}

// ── Allowlist & khử nhạy cảm ───────────────────────────────────────────────

const FORBIDDEN_KEY =
  /cccd|national.?id|id.?number|passport|password|passwd|secret|token|private.?key|credential|signature.?(value|bytes)|certificate.?pem|api.?key|attachment|(tenant|landlord)(name|address)|meter|key.?count|inventory|notes?$|discrepancy|override.?reason/i

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') {
    const out: Dict = {}
    for (const [key, item] of Object.entries(value as Dict)) {
      if (FORBIDDEN_KEY.test(key) || item === undefined) continue
      out[key] = scrub(item)
    }
    return out
  }
  return value
}

function pick(source: Dict | null | undefined, keys: readonly string[]): Dict {
  const out: Dict = {}
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined) out[key] = value
  }
  return scrub(out) as Dict
}

const PARTICIPANT_EVENT_FIELDS = [
  'eventType',
  'aggregateType',
  'status',
  'networkMode',
  'txId',
  'blockNumber',
  'recordedAt',
  'payloadHash',
  'dependsOn',
] as const
const OPERATOR_EVENT_FIELDS = [
  ...PARTICIPANT_EVENT_FIELDS,
  'attempts',
  'errorCode',
] as const

function sortBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
}

function textOf(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}

function jsonEntry(
  path: string,
  category: string,
  value: unknown
): EvidencePackageEntry {
  const content = stableStringify(scrub(value))
  return {
    path,
    category,
    mediaType: 'application/json',
    byteLength: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    source: { type: 'json', content },
  }
}

/** Gói bị ngắt giữa chừng (client rời đi hoặc lỗi stream). Không mang thông điệp lỗi gốc để tránh lộ chi tiết. */
export class EvidencePackageAbortedError extends Error {
  constructor(public readonly reason: 'client-abort' | 'stream-error') {
    super(
      reason === 'client-abort'
        ? 'Evidence package export aborted by the client'
        : 'Evidence package export failed while streaming'
    )
    this.name = 'EvidencePackageAbortedError'
  }
}

export type EvidenceZipOptions = {
  /** Mở stream bytes của artifact (GridFS) cho entry `artifact`; không bao giờ trả Buffer cả file. */
  openArtifact: (entry: EvidencePackageEntry) => Promise<Readable>
  signal?: AbortSignal
}

@Injectable()
export class ContractEvidencePackageService {
  constructor(@Optional() private readonly configService?: ConfigService) {}

  buildPlan(input: EvidencePackageInput): EvidencePackagePlan {
    const artifact = this.requireArtifact(input)
    const operator =
      input.viewer.role === 'staff' || input.viewer.role === 'admin'
    const verification = this.verify(input, artifact)

    const entries: EvidencePackageEntry[] = []
    const categories = {} as EvidencePackageManifest['categories']
    const record = (
      name: CategoryName,
      entry: EvidencePackageEntry | null
    ): void => {
      categories[name] = { present: entry !== null, entry: entry?.path ?? null }
      if (entry) entries.push(entry)
    }

    // 1. Báo cáo xác minh (xác định: không mang metadata sinh gói).
    entries.push(
      jsonEntry('verification-report.json', 'verification', verification)
    )

    // 2. Artifact PDF ký chuẩn — nguồn GridFS, hash = hash canonical đã ghi nhận.
    entries.push({
      path: `contract/contract-r${artifact.revision}.pdf`,
      category: 'contract',
      mediaType: artifact.contentType,
      byteLength: artifact.byteLength,
      sha256: artifact.recordedHash,
      source: {
        type: 'artifact',
        artifactId: artifact.artifactId,
        revision: artifact.revision,
      },
    })

    // 3. Các nhóm bằng chứng (D8), nhóm vắng mặt chỉ được đánh dấu not present.
    const events = this.ledgerEvents(input.ledgerEvents, operator)
    record(
      'ledgerEvents',
      events.length > 0
        ? jsonEntry('evidence/ledger-events.json', 'ledgerEvents', events)
        : null
    )
    record(
      'governance',
      input.governance
        ? jsonEntry(
            'evidence/governance-snapshot.json',
            'governance',
            this.governanceEntry(input.governance, operator)
          )
        : null
    )
    record(
      'deposit',
      input.deposit
        ? jsonEntry(
            'evidence/deposit.json',
            'deposit',
            pick(input.deposit, [
              'depositId',
              'amount',
              'depositHash',
              'status',
              'paidAt',
              'ledgerStatus',
            ])
          )
        : null
    )
    const payments = this.payments(input.payments ?? [], input.viewer.role)
    record(
      'payments',
      payments.length > 0
        ? jsonEntry('evidence/payments.json', 'payments', payments)
        : null
    )
    const amendments = sortBy(
      (input.amendments ?? []).map(item =>
        pick(item, [
          'amendmentId',
          'sequence',
          'contentHash',
          'effectiveFrom',
          'ledgerStatus',
          'ledgerTxHash',
        ])
      ),
      item =>
        `${String(textOf(item.sequence)).padStart(8, '0')}:${textOf(item.amendmentId)}`
    )
    record(
      'amendments',
      amendments.length > 0
        ? jsonEntry('evidence/amendments.json', 'amendments', amendments)
        : null
    )
    record(
      'termination',
      input.termination
        ? jsonEntry(
            'evidence/termination.json',
            'termination',
            pick(input.termination, [
              'reasonCode',
              'reasonHash',
              'terminatedAt',
              'ledgerStatus',
              'ledgerTxHash',
            ])
          )
        : null
    )
    record(
      'settlement',
      input.settlement
        ? jsonEntry(
            'evidence/settlement.json',
            'settlement',
            this.settlementEntry(input.settlement)
          )
        : null
    )
    record(
      'handover',
      input.handover
        ? jsonEntry(
            'evidence/handover.json',
            'handover',
            pick(input.handover, [
              'settlementId',
              'revision',
              'handoverHash',
              'completedAt',
              'overrideUsed',
              'completionReason',
              'responseDueAt',
              'disputeCount',
              'ledgerStatus',
              'ledgerTxHash',
              'manifestHash',
            ])
          )
        : null
    )

    // Hash logic: chỉ metadata entry đã sắp xếp + định danh hợp đồng/artifact.
    const packageHash = sha256Hex({
      manifestVersion: EVIDENCE_PACKAGE_MANIFEST_VERSION,
      contractId: input.contract.id,
      artifactId: artifact.artifactId,
      artifactRevision: artifact.revision,
      entries: sortBy(entries, e => e.path).map(e => ({
        path: e.path,
        mediaType: e.mediaType,
        byteLength: e.byteLength,
        sha256: e.sha256,
      })),
    })

    const byEventType: Record<string, number> = {}
    for (const event of events) {
      const type = textOf(event.eventType) || 'unknown'
      byEventType[type] = (byEventType[type] ?? 0) + 1
    }

    const manifest: EvidencePackageManifest = {
      manifestVersion: EVIDENCE_PACKAGE_MANIFEST_VERSION,
      packageHash,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      audience: operator ? 'operator' : 'participant',
      contract: {
        id: input.contract.id,
        contractCode: input.contract.contractCode ?? null,
        artifactId: artifact.artifactId,
        artifactRevision: artifact.revision,
      },
      entries: entries.map(e => ({
        path: e.path,
        category: e.category,
        mediaType: e.mediaType,
        byteLength: e.byteLength,
        sha256: e.sha256,
      })),
      categories,
      ledgerEventSummary: { total: events.length, byEventType },
      governanceSnapshot: input.governance
        ? {
            snapshotId: input.governance.snapshotId,
            version: input.governance.version,
            manifestHash: input.governance.manifestHash,
          }
        : null,
      verification,
    }
    const manifestEntry = jsonEntry('manifest.json', 'manifest', manifest)
    this.assertWithinLimits(entries, manifestEntry)

    const ordered = [manifestEntry, ...entries]
    return {
      manifest,
      manifestJson: (manifestEntry.source as { content: string }).content,
      packageHash,
      verification,
      entries,
      orderedEntries: () => ordered,
    }
  }

  // ── Kiểm tra toàn vẹn và 3 lớp xác minh ────────────────────────────────────

  private requireArtifact(
    input: EvidencePackageInput
  ): NonNullable<EvidencePackageInput['artifact']> {
    const artifact = input.artifact
    if (!artifact || !artifact.byteLength || artifact.byteLength <= 0) {
      throw new UnprocessableEntityException({
        code: 'EVIDENCE_PACKAGE_INCOMPLETE',
        message:
          'Thiếu artifact hợp đồng đã ký chuẩn; không thể xuất gói đầy đủ',
      })
    }
    if (
      artifact.computedHash !== null &&
      artifact.computedHash !== artifact.recordedHash
    ) {
      // Chặn xuất thường; chỉ trả định danh đã khử nhạy cảm (không lộ hash) cho nhật ký điều tra.
      throw new ConflictException({
        code: 'EVIDENCE_ARTIFACT_MISMATCH',
        message:
          'Bytes artifact đang lưu không khớp hash canonical đã ghi nhận',
        finding: {
          category: 'artifact_hash_mismatch',
          contractId: input.contract.id,
          artifactId: artifact.artifactId,
          revision: artifact.revision,
        },
      })
    }
    return artifact
  }

  private verify(
    input: EvidencePackageInput,
    artifact: NonNullable<EvidencePackageInput['artifact']>
  ): EvidenceVerificationReport {
    const database: EvidenceVerificationLayer =
      artifact.computedHash === null
        ? { status: 'unavailable', reason: 'ARTIFACT_HASH_NOT_COMPUTED' }
        : { status: 'verified', reason: null }

    const { expectedHash, projectedHash } = input.projection
    const projection: EvidenceVerificationLayer =
      !expectedHash || !projectedHash
        ? { status: 'unavailable', reason: 'PROJECTION_HASH_MISSING' }
        : expectedHash === projectedHash
          ? { status: 'verified', reason: null }
          : { status: 'mismatch', reason: 'PROJECTION_HASH_DIFFERS' }

    // Simulation không bao giờ là bằng chứng Fabric: không được báo verified.
    const ledger: EvidenceVerificationLayer =
      input.ledger.networkMode === 'simulation'
        ? { status: 'unavailable', reason: 'FABRIC_SIMULATION_MODE' }
        : {
            status: input.ledger.status,
            reason:
              input.ledger.reason ??
              (input.ledger.status === 'unavailable'
                ? 'FABRIC_UNAVAILABLE'
                : input.ledger.status === 'mismatch'
                  ? 'LEDGER_HASH_DIFFERS'
                  : null),
          }

    return {
      database,
      projection,
      ledger,
      endToEnd: [database, projection, ledger].every(
        layer => layer.status === 'verified'
      ),
    }
  }

  // ── Nội dung theo vai trò ──────────────────────────────────────────────────

  private ledgerEvents(events: Dict[], operator: boolean): Dict[] {
    const fields = operator ? OPERATOR_EVENT_FIELDS : PARTICIPANT_EVENT_FIELDS
    return sortBy(
      events.map(event => pick(event, fields)),
      event =>
        `${textOf(event.recordedAt)}|${textOf(event.eventType)}|${textOf(event.aggregateType)}|${textOf(event.payloadHash)}`
    )
  }

  private governanceEntry(
    governance: NonNullable<EvidencePackageInput['governance']>,
    operator: boolean
  ): Dict {
    const base = pick(governance, [
      'snapshotId',
      'snapshotCode',
      'version',
      'manifestHash',
    ])
    return operator && governance.components
      ? { ...base, components: scrub(governance.components) }
      : base
  }

  private payments(payments: Dict[], role: EvidenceViewerRole): Dict[] {
    const operator = role === 'staff' || role === 'admin'
    return sortBy(
      payments
        // Người tham gia không thấy hoá đơn phí nền tảng của bên kia.
        .filter(
          payment =>
            operator ||
            payment.type !== 'platform-fee' ||
            payment.payerRole === role
        )
        .map(payment =>
          pick(payment, [
            'paymentId',
            'type',
            'amount',
            'status',
            'paidAt',
            'paymentHash',
            'ledgerStatus',
            'periodKey',
            'payerRole',
          ])
        ),
      payment => textOf(payment.paymentId)
    )
  }

  private settlementEntry(settlement: Dict): Dict {
    const lines = Array.isArray(settlement.lines)
      ? sortBy(
          (settlement.lines as Dict[]).map(line =>
            pick(line, ['kind', 'amount', 'paymentId'])
          ),
          line => `${textOf(line.kind)}:${textOf(line.paymentId)}`
        )
      : undefined
    return {
      ...pick(settlement, [
        'settlementId',
        'status',
        'total',
        'statementHash',
        'manifestHash',
        'ledgerStatus',
        'ledgerTxHash',
      ]),
      ...(lines ? { lines } : {}),
    }
  }

  // ── Streaming ZIP có giới hạn (D8, tasks 9.4/9.5) ──────────────────────────

  /**
   * Băm artifact theo stream (bộ nhớ O(chunk)). Dừng sớm khi vượt độ dài đã ghi nhận để không
   * đọc hết một file lớn bất thường. Lỗi đọc → EVIDENCE_PACKAGE_INCOMPLETE.
   */
  async hashArtifactStream(
    stream: Readable,
    expectedByteLength: number
  ): Promise<{ sha256: string | null; byteLength: number }> {
    const hash = createHash('sha256')
    let byteLength = 0
    try {
      for await (const chunk of stream) {
        byteLength += (chunk as Buffer).length
        if (byteLength > expectedByteLength) {
          stream.destroy()
          return { sha256: null, byteLength }
        }
        hash.update(chunk as Buffer)
      }
    } catch {
      stream.destroy()
      throw this.incomplete()
    }
    return { sha256: hash.digest('hex'), byteLength }
  }

  /**
   * Ghi ZIP theo stream vào `destination`: manifest.json trước, JSON in-memory nhỏ, artifact PDF
   * từ GridFS qua stream + kiểm hash/độ dài khi đi qua (không nạp cả file/gói vào RAM). Dừng ngay
   * ở giới hạn byte cấu hình; khi lỗi/ngắt kết nối giải phóng mọi stream đang mở.
   */
  async writeZip(
    plan: EvidencePackagePlan,
    destination: Writable,
    options: EvidenceZipOptions
  ): Promise<{ bytesWritten: number; entries: number }> {
    const maxBytes = this.limit('maxBytes', DEFAULT_MAX_BYTES)
    const ordered = plan.orderedEntries()
    const artifactEntry = ordered.find(
      entry => entry.source.type === 'artifact'
    )

    // Mở trước khi ghi bất kỳ byte nào: thiếu bytes PDF → từ chối, không trả gói dở dang.
    let artifactStream: Readable | null = null
    if (artifactEntry) {
      try {
        artifactStream = await options.openArtifact(artifactEntry)
      } catch {
        throw this.incomplete()
      }
    }

    const zip = new ZipArchive({ zlib: { level: 6 } })
    const entryDate = new Date(plan.manifest.generatedAt)
    let bytesWritten = 0
    const counter = new Transform({
      transform: (chunk: Buffer, _encoding, callback): void => {
        bytesWritten += chunk.length
        if (bytesWritten > maxBytes) {
          callback(this.tooLargeError('maxBytes'))
          return
        }
        callback(null, chunk)
      },
    })
    const verifier = artifactEntry
      ? this.artifactVerifier(plan, artifactEntry)
      : null

    let destinationClosedEarly = false
    const onDestinationClose = (): void => {
      if (!destination.writableFinished) destinationClosedEarly = true
    }
    destination.once('close', onDestinationClose)

    const abortController = new AbortController()
    let externalAbort = false
    const onExternalAbort = (): void => {
      externalAbort = true
      abortController.abort()
    }
    options.signal?.addEventListener('abort', onExternalAbort, { once: true })

    const cleanup = (): void => {
      zip.abort()
      artifactStream?.destroy()
      verifier?.destroy()
      if (!destination.destroyed) destination.destroy()
    }

    try {
      for (const entry of ordered) {
        if (entry.source.type === 'json') {
          zip.append(entry.source.content, {
            name: entry.path,
            date: entryDate,
          })
        } else if (artifactStream && verifier) {
          artifactStream.once('error', error => verifier.destroy(error))
          artifactStream.pipe(verifier)
          // PDF đã nén sẵn: ghi stored để không tốn CPU.
          zip.append(verifier, {
            name: entry.path,
            date: entryDate,
            store: true,
          })
        }
      }

      const failure = new Promise<never>((_resolve, reject) => {
        verifier?.once('error', reject)
        zip.once('error', reject)
      })
      const done = pipeline(zip, counter, destination, {
        signal: abortController.signal,
      })
      done.catch(() => undefined)
      failure.catch(() => undefined)
      void zip.finalize().catch(() => undefined)
      await Promise.race([done, failure])
      return { bytesWritten, entries: ordered.length }
    } catch (error) {
      cleanup()
      if (error instanceof HttpException) throw error
      throw new EvidencePackageAbortedError(
        destinationClosedEarly || externalAbort
          ? 'client-abort'
          : 'stream-error'
      )
    } finally {
      destination.off('close', onDestinationClose)
      options.signal?.removeEventListener('abort', onExternalAbort)
    }
  }

  /** Kiểm hash + độ dài khi bytes đi qua; lệch → huỷ gói bằng EVIDENCE_ARTIFACT_MISMATCH. */
  private artifactVerifier(
    plan: EvidencePackagePlan,
    entry: EvidencePackageEntry
  ): Transform {
    const hash = createHash('sha256')
    let bytes = 0
    const mismatch = (): ConflictException =>
      new ConflictException({
        code: 'EVIDENCE_ARTIFACT_MISMATCH',
        message:
          'Bytes artifact đang lưu không khớp hash canonical đã ghi nhận',
        finding: {
          category: 'artifact_hash_mismatch',
          contractId: plan.manifest.contract.id,
          artifactId: plan.manifest.contract.artifactId,
          revision: plan.manifest.contract.artifactRevision,
        },
      })
    return new Transform({
      transform(chunk: Buffer, _encoding, callback): void {
        bytes += chunk.length
        if (bytes > entry.byteLength) {
          callback(mismatch())
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
      flush(callback): void {
        if (bytes !== entry.byteLength || hash.digest('hex') !== entry.sha256) {
          callback(mismatch())
          return
        }
        callback()
      },
    })
  }

  private incomplete(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      code: 'EVIDENCE_PACKAGE_INCOMPLETE',
      message: 'Thiếu artifact hợp đồng đã ký chuẩn; không thể xuất gói đầy đủ',
    })
  }

  private tooLargeError(
    limit: 'maxFiles' | 'maxBytes'
  ): PayloadTooLargeException {
    return new PayloadTooLargeException({
      code: 'EVIDENCE_PACKAGE_TOO_LARGE',
      message: 'Gói bằng chứng vượt giới hạn cấu hình',
      limit,
    })
  }

  // ── Giới hạn kích thước khai báo ───────────────────────────────────────────

  private assertWithinLimits(
    entries: EvidencePackageEntry[],
    manifestEntry: EvidencePackageEntry
  ): void {
    const maxFiles = this.limit('maxFiles', DEFAULT_MAX_FILES)
    const maxBytes = this.limit('maxBytes', DEFAULT_MAX_BYTES)
    const files = entries.length + 1
    const bytes = entries.reduce(
      (sum, e) => sum + e.byteLength,
      manifestEntry.byteLength
    )
    if (files > maxFiles) this.tooLarge('maxFiles')
    if (bytes > maxBytes) this.tooLarge('maxBytes')
  }

  private limit(key: 'maxFiles' | 'maxBytes', fallback: number): number {
    const value = this.configService?.get<number>(`evidencePackage.${key}`)
    return typeof value === 'number' && value >= 1 ? value : fallback
  }

  private tooLarge(limit: 'maxFiles' | 'maxBytes'): never {
    throw this.tooLargeError(limit)
  }
}
