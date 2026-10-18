import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ContractsService } from './contracts.service'
import { ContractArtifactService } from './contract-artifact.service'
import {
  ContractEvidencePackageService,
  EvidencePackageAbortedError,
  type EvidencePackageInput,
  type EvidencePackagePlan,
  type EvidenceViewerRole,
} from './contract-evidence-package.service'
import { Contract } from '../schemas/contract.schema'
import { DepositAgreement } from '../schemas/deposit-agreement.schema'
import { ContractAmendmentStore } from './contract-amendment.store'
import { Payment } from '../../payments/schemas/payment.schema'
import { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'
import { FabricService } from '../../fabric/services/fabric.service'
import { FabricGovernanceService } from '../../fabric/services/fabric-governance.service'
import { LedgerEvidenceQueryService } from '../../fabric/services/ledger-evidence-query.service'
import { RentalTransactionEventService } from '../../rental/services/rental-transaction-event.service'
import type { RentalTransactionActorRole } from '../../rental/schemas/rental-transaction-event.schema'

export type EvidenceExportActor = { id: string; roles: string[] }

export type PreparedEvidenceExport = {
  filename: string
  contentType: 'application/zip'
  packageHash: string
  revision: number
  /** Stream gói vào `destination` (thường là HTTP response); ghi nhật ký started/completed/aborted. */
  run(destination: Writable, signal?: AbortSignal): Promise<void>
}

type Dict = Record<string, unknown>

@Injectable()
export class ContractEvidencePackageExportService {
  private readonly logger = new Logger(
    ContractEvidencePackageExportService.name
  )

  constructor(
    private readonly contractsService: ContractsService,
    private readonly artifactService: ContractArtifactService,
    private readonly packageService: ContractEvidencePackageService,
    private readonly ledgerEvidenceQueryService: LedgerEvidenceQueryService,
    private readonly fabricService: FabricService,
    @InjectRepository(DepositAgreement)
    private readonly depositRepository: Repository<DepositAgreement>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly amendmentRepository: ContractAmendmentStore,
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepository: Repository<MoveInSettlement>,
    @Optional()
    private readonly governanceService?: FabricGovernanceService,
    @Optional()
    private readonly transactionEventService?: RentalTransactionEventService
  ) {}

  /**
   * Kiểm tra quyền, xác minh toàn vẹn artifact (băm theo stream, không nạp PDF vào RAM), thu thập
   * bằng chứng đã ủy quyền và dựng kế hoạch gói. Mọi lỗi ở bước này xảy ra TRƯỚC khi gửi byte nào
   * nên controller vẫn trả được lỗi JSON ổn định.
   */
  async prepare(
    contractId: string,
    actor: EvidenceExportActor,
    query: { revision?: number | undefined } = {}
  ): Promise<PreparedEvidenceExport> {
    const isOperator = actor.roles.some(
      role => role === 'staff' || role === 'admin'
    )
    // Dùng đúng chính sách quan hệ hiện có (participant | staff | admin; người lạ bị từ chối).
    const contract = await this.contractsService.findOneForUser(
      contractId,
      actor.id,
      isOperator
    )
    const viewerRole = this.viewerRole(contract, actor)
    const actorRole = viewerRole as RentalTransactionActorRole

    const resolved = await this.resolveArtifact(
      contract,
      query.revision,
      actorRole,
      actor.id
    )

    const hashed = await this.packageService.hashArtifactStream(
      await this.openOrIncomplete(resolved.open),
      resolved.artifact.byteLength
    )
    const computedHash =
      hashed.sha256 !== null &&
      hashed.byteLength === resolved.artifact.byteLength
        ? hashed.sha256
        : 'size-mismatch'

    const input = await this.collectInput(contract, viewerRole, {
      artifactId: resolved.artifact._id.toHexString(),
      revision: resolved.artifact.revision,
      contentType: 'application/pdf',
      byteLength: resolved.artifact.byteLength,
      recordedHash: resolved.recordedHash,
      computedHash,
    })

    let plan: EvidencePackagePlan
    try {
      plan = this.packageService.buildPlan(input)
    } catch (error) {
      if (this.isMismatch(error)) {
        await this.recordIntegrityFinding(contract, actorRole, actor.id)
      }
      throw error
    }

    const revision = resolved.artifact.revision
    return {
      filename: `evidence-${this.safeName(contract.contractCode, contractId)}-r${revision}.zip`,
      contentType: 'application/zip',
      packageHash: plan.packageHash,
      revision,
      run: (destination, signal) =>
        this.run(plan, resolved.open, destination, signal, {
          contractId,
          actorRole,
          actorId: actor.id,
          artifactId: resolved.artifact._id.toHexString(),
        }),
    }
  }

  private async run(
    plan: EvidencePackagePlan,
    open: () => Promise<import('node:stream').Readable>,
    destination: Writable,
    signal: AbortSignal | undefined,
    audit: {
      contractId: string
      actorRole: RentalTransactionActorRole
      actorId: string
      artifactId: string
    }
  ): Promise<void> {
    const exportId = randomUUID()
    await this.recordEvent(audit, exportId, 'export-started', null)
    try {
      await this.packageService.writeZip(plan, destination, {
        openArtifact: () => open(),
        ...(signal ? { signal } : {}),
      })
      await this.recordEvent(audit, exportId, 'export-completed', null)
    } catch (error) {
      let reason = 'EXPORT_FAILED'
      if (error instanceof EvidencePackageAbortedError) {
        reason =
          error.reason === 'client-abort' ? 'CLIENT_ABORT' : 'STREAM_ERROR'
      } else if (this.isMismatch(error)) {
        reason = 'EVIDENCE_ARTIFACT_MISMATCH'
        await this.recordEvent(audit, exportId, 'integrity-finding', reason)
      } else if (error instanceof UnprocessableEntityException) {
        reason = 'EVIDENCE_PACKAGE_INCOMPLETE'
      }
      await this.recordEvent(audit, exportId, 'export-aborted', reason)
      throw error
    }
  }

  // ── Artifact ───────────────────────────────────────────────────────────────

  private async resolveArtifact(
    contract: Contract,
    revision: number | undefined,
    actorRole: RentalTransactionActorRole,
    actorId: string
  ): Promise<
    Awaited<
      ReturnType<ContractArtifactService['openCanonicalArtifactForExport']>
    >
  > {
    try {
      return await this.artifactService.openCanonicalArtifactForExport(
        contract,
        revision
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        error instanceof NotFoundException &&
        this.codeOf(error) === 'EVIDENCE_VERSION_NOT_FOUND'
      ) {
        throw error
      }
      if (
        message === 'CONTRACT_ARTIFACT_SUPERSEDED' ||
        message === 'CONTRACT_ARTIFACT_HASH_MISMATCH'
      ) {
        await this.recordIntegrityFinding(contract, actorRole, actorId)
        throw new ConflictException({
          code: 'EVIDENCE_ARTIFACT_MISMATCH',
          message:
            'Artifact hợp đồng không khớp bản ghi canonical; không thể xuất gói',
          finding: {
            category: 'artifact_hash_mismatch',
            contractId: contract._id.toHexString(),
            artifactId: contract.artifactRef?.artifactId ?? null,
            revision: contract.artifactRef?.revision ?? null,
          },
        })
      }
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw new UnprocessableEntityException({
          code: 'EVIDENCE_PACKAGE_INCOMPLETE',
          message:
            'Thiếu artifact hợp đồng đã ký chuẩn; không thể xuất gói đầy đủ',
        })
      }
      throw error
    }
  }

  private async openOrIncomplete(
    open: () => Promise<import('node:stream').Readable>
  ): Promise<import('node:stream').Readable> {
    try {
      return await open()
    } catch {
      throw new UnprocessableEntityException({
        code: 'EVIDENCE_PACKAGE_INCOMPLETE',
        message:
          'Thiếu artifact hợp đồng đã ký chuẩn; không thể xuất gói đầy đủ',
      })
    }
  }

  // ── Thu thập bằng chứng đã được ủy quyền ───────────────────────────────────

  private async collectInput(
    contract: Contract,
    viewerRole: EvidenceViewerRole,
    artifact: NonNullable<EvidencePackageInput['artifact']>
  ): Promise<EvidencePackageInput> {
    const contractId = contract._id.toHexString()
    const [evidence, deposit, payments, amendments, settlement, governance] =
      await Promise.all([
        this.ledgerEvidenceQueryService
          .getContractLedgerEvidence(contractId, contract)
          .catch(() => null),
        this.loadDeposit(contract),
        this.paymentRepository.find({ where: { contractId } }),
        this.amendmentRepository.find({ where: { contractId } }),
        this.settlementRepository.findOne({ where: { contractId } }),
        this.loadGovernance(contract),
      ])

    const mode = this.fabricService.getStatus().mode
    return {
      contract: {
        id: contractId,
        contractCode: contract.contractCode ?? null,
        status: contract.status ?? null,
      },
      viewer: { role: viewerRole },
      artifact: {
        artifactId: artifact.artifactId,
        revision: artifact.revision,
        contentType: 'application/pdf',
        byteLength: artifact.byteLength,
        recordedHash: artifact.recordedHash,
        computedHash: artifact.computedHash,
      },
      ledgerEvents: (evidence?.events ?? []) as unknown as Dict[],
      governance,
      deposit: deposit
        ? {
            depositId: deposit._id.toHexString(),
            amount: deposit.amount,
            depositHash: deposit.depositHash,
            status: deposit.status,
            paidAt: deposit.paidAt ?? null,
            ledgerStatus: deposit.ledgerStatus ?? null,
          }
        : null,
      payments: payments.map(payment => ({
        paymentId: payment._id.toHexString(),
        type: payment.type ?? null,
        amount: payment.amount,
        status: payment.status,
        paidAt: payment.paidAt ?? null,
        paymentHash: payment.paymentHash ?? null,
        ledgerStatus: payment.ledgerStatus ?? null,
        periodKey: payment.periodKey ?? null,
        payerRole: payment.payerRole ?? null,
      })),
      amendments: amendments
        .filter(amendment => amendment.status === 'effective')
        .map(amendment => ({
          amendmentId: amendment._id.toHexString(),
          sequence: amendment.sequence,
          contentHash: amendment.contentHash ?? null,
          effectiveFrom: amendment.effectiveFrom,
          ledgerStatus: amendment.ledgerStatus ?? null,
          ledgerTxHash: amendment.ledgerTxHash ?? null,
        })),
      termination: contract.terminatedAt
        ? {
            reasonCode: contract.terminationReasonCode ?? null,
            terminatedAt: contract.terminatedAt,
            ledgerTxHash: contract.terminationTxHash ?? null,
          }
        : null,
      settlement: settlement
        ? {
            settlementId: settlement._id.toHexString(),
            status: settlement.status,
            total: settlement.total,
            statementHash: settlement.statementHash,
            lines: settlement.lines.map(line => ({
              kind: line.kind,
              amount: line.amount,
              paymentId: line.paymentId,
            })),
            manifestHash: settlement.settlementEvidence?.manifestHash ?? null,
            ledgerStatus: settlement.settlementEvidence?.ledgerStatus ?? null,
            ledgerTxHash: settlement.settlementEvidence?.txHash ?? null,
          }
        : null,
      handover: settlement?.handover?.completedAt
        ? {
            settlementId: settlement._id.toHexString(),
            revision: settlement.handover.revision,
            handoverHash: settlement.handover.handoverHash,
            completedAt: settlement.handover.completedAt,
            overrideUsed: Boolean(settlement.handover.overrideReason?.trim()),
            // Danh mục tài sản và nội dung phản hồi sai lệch là dữ liệu riêng (bị scrub);
            // gói chỉ mang lý do hoàn tất, hạn phản hồi và số phản hồi.
            completionReason: settlement.handover.completionReason ?? null,
            responseDueAt: settlement.handover.responseDueAt ?? null,
            disputeCount: settlement.handover.discrepancies?.length ?? 0,
            manifestHash: settlement.handoverEvidence?.manifestHash ?? null,
            ledgerStatus: settlement.handoverEvidence?.ledgerStatus ?? null,
            ledgerTxHash: settlement.handoverEvidence?.txHash ?? null,
          }
        : null,
      projection: {
        expectedHash: artifact.recordedHash,
        projectedHash: contract.contractHash ?? null,
      },
      ledger: await this.verifyLedger(contract, mode),
    }
  }

  private async loadDeposit(
    contract: Contract
  ): Promise<DepositAgreement | null> {
    if (
      !contract.depositAgreementId ||
      !ObjectId.isValid(contract.depositAgreementId)
    ) {
      return null
    }
    return this.depositRepository.findOne({
      where: { _id: new ObjectId(contract.depositAgreementId) },
    })
  }

  private async loadGovernance(
    contract: Contract
  ): Promise<EvidencePackageInput['governance']> {
    const ref = contract.governanceSnapshotRef
    if (!ref) return null
    const base = {
      snapshotId: ref.snapshotId,
      version: ref.version,
      manifestHash: ref.manifestHash,
    }
    try {
      const snapshot = await this.governanceService?.getById(ref.snapshotId)
      return snapshot
        ? {
            ...base,
            snapshotCode: snapshot.snapshotCode,
            components: snapshot.components as unknown as Dict,
          }
        : base
    } catch {
      return base
    }
  }

  /** Ledger sống: chỉ `verified` khi Fabric xác nhận hash đã neo; mọi lỗi truy vấn → unavailable. */
  private async verifyLedger(
    contract: Contract,
    mode: 'fabric' | 'simulation'
  ): Promise<EvidencePackageInput['ledger']> {
    if (!contract.blockchainAddress || contract.ledgerStatus !== 'confirmed') {
      return {
        status: 'unavailable',
        networkMode: mode,
        reason: 'LEDGER_NOT_RECORDED',
      }
    }
    if (mode === 'simulation') {
      return { status: 'unavailable', networkMode: mode }
    }
    try {
      const raw = await this.fabricService.evaluateTransaction(
        'verifyContract',
        [contract._id.toHexString(), contract.contractHash ?? '']
      )
      const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        valid?: boolean
      } | null
      return {
        status: result?.valid === true ? 'verified' : 'mismatch',
        networkMode: mode,
      }
    } catch {
      return { status: 'unavailable', networkMode: mode }
    }
  }

  // ── Nhật ký xuất gói (không chứa nội dung gói) ─────────────────────────────

  private async recordIntegrityFinding(
    contract: Contract,
    actorRole: RentalTransactionActorRole,
    actorId: string
  ): Promise<void> {
    await this.recordEvent(
      {
        contractId: contract._id.toHexString(),
        actorRole,
        actorId,
      },
      randomUUID(),
      'integrity-finding',
      'EVIDENCE_ARTIFACT_MISMATCH'
    )
  }

  private async recordEvent(
    audit: {
      contractId: string
      actorRole: RentalTransactionActorRole
      actorId: string
    },
    exportId: string,
    stage:
      | 'export-started'
      | 'export-completed'
      | 'export-aborted'
      | 'integrity-finding',
    reasonCode: string | null
  ): Promise<void> {
    if (!this.transactionEventService) return
    try {
      await this.transactionEventService.record({
        transactionKey: audit.contractId,
        transitionKey: `evidence-package:${audit.contractId}:${exportId}:${stage}`,
        contractId: audit.contractId,
        eventType: `evidence-package.${stage}`,
        actorRole: audit.actorRole,
        actorId: audit.actorId,
        reasonCode,
        refs: { contractId: audit.contractId, status: stage },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Evidence package audit failed [${stage}]: ${message}`)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private viewerRole(
    contract: Contract,
    actor: EvidenceExportActor
  ): EvidenceViewerRole {
    if (actor.roles.includes('admin')) return 'admin'
    if (actor.roles.includes('staff')) return 'staff'
    return contract.tenantId === actor.id ? 'tenant' : 'landlord'
  }

  private safeName(code: string | null | undefined, fallback: string): string {
    const cleaned = (code ?? '').replace(/[^A-Za-z0-9_-]/g, '')
    return cleaned.length > 0 ? cleaned.slice(0, 40) : fallback
  }

  private codeOf(error: unknown): string | undefined {
    const response = (error as { getResponse?: () => unknown })?.getResponse?.()
    return typeof response === 'object' && response !== null
      ? (response as { code?: string }).code
      : undefined
  }

  private isMismatch(error: unknown): boolean {
    return (
      error instanceof ConflictException &&
      this.codeOf(error) === 'EVIDENCE_ARTIFACT_MISMATCH'
    )
  }
}
