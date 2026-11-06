import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Contract } from '../../contracts/schemas/contract.schema'
import { StorageService } from '../../../common/storage/storage.service'
import { assertMeterPhotosHosted } from '../utils/utility-charges.util'
import { sha256Hex } from '../../fabric/utils/canonical-json'
import {
  buildMoveInHandoverEvidenceEnvelope,
  hashMoveInHandoverEvidenceEnvelope,
} from '../../fabric/utils/move-in-handover-evidence-envelope'
import { buildHandoverArgs } from '../../fabric/utils/ledger-action-args'
import { MoveInSettlement } from '../schemas/move-in-settlement.schema'
import type {
  MoveOutHandover as MoveOutHandoverEntity,
  MoveOutInventoryItem,
  MoveOutItemCondition,
} from '../schemas/move-out-handover.schema'
import { MoveOutHandover } from '../schemas/move-out-handover.schema'
import { renderMoveOutHandoverPdf } from '../utils/move-out-handover-pdf.renderer'
import {
  addDays,
  assertPartyOrStaff,
  isDuplicateKeyError,
  loadContract,
  pendingEvidence,
  resolveMoveOutResponseDays,
} from '../utils/move-out.util'
import { MoveOutSupportService } from './move-out-support.service'

const MOVE_OUT_CONTRACT_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'terminated',
])

export type RecordMoveOutInput = {
  handedBackAt: string
  electricity: number
  water: number
  meterPhotos?: { electricity: string[]; water: string[] }
  acknowledgeMeterRegression?: boolean
  keyCount: number
  inventoryItems?: Array<{
    name: string
    quantity: number
    condition: MoveOutItemCondition
    note?: string
  }>
  notes?: string
}

type Baseline = NonNullable<MoveInSettlement['handover']>

const nameKey = (name: string): string => name.trim().toLowerCase()

@Injectable()
export class MoveOutHandoversService {
  private readonly logger = new Logger(MoveOutHandoversService.name)

  constructor(
    @InjectRepository(MoveOutHandover)
    private readonly repo: Repository<MoveOutHandover>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(MoveInSettlement)
    private readonly settlementRepo: Repository<MoveInSettlement>,
    private readonly support: MoveOutSupportService,
    @Optional() private readonly storage?: StorageService
  ) {}

  async findByContract(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<MoveOutHandoverEntity> {
    const handover = await this.findOrFail(contractId)
    assertPartyOrStaff(handover, actorId, isStaff, 'MOVE_OUT_ACCESS_DENIED')
    return handover
  }

  async record(
    contractId: string,
    actorId: string,
    input: RecordMoveOutInput,
    now = new Date()
  ): Promise<MoveOutHandoverEntity> {
    const contract = await this.loadLandlordContract(contractId, actorId)
    assertMeterPhotosHosted(this.storage, input.meterPhotos)
    if (await this.repo.findOne({ where: { contractId } }))
      throw new ConflictException('MOVE_OUT_HANDOVER_EXISTS')
    const baseline = await this.loadBaseline(contractId)
    const responseDays = resolveMoveOutResponseDays(contract.packageSnapshot)
    this.assertMeterNotBelowMoveIn(input, baseline)
    const body = this.buildBody(1, input, baseline)
    const handoverHash = this.hashOf(body)
    const entity = this.repo.create({
      contractId,
      tenantId: contract.tenantId,
      landlordId: contract.landlordId,
      revision: 1,
      handedBackAt: new Date(input.handedBackAt),
      meterReadings: body.meterReadings,
      meterPhotos: body.meterPhotos ?? null,
      keyCount: input.keyCount,
      inventoryItems: body.inventoryItems,
      notes: body.notes,
      discrepancies: [],
      revisionHistory: [],
      responseDays,
      responseDueAt: addDays(now, responseDays),
      status: 'recorded',
      handoverHash,
      recordedBy: actorId,
      tenantConfirmation: null,
      landlordConfirmation: { at: now, hash: handoverHash },
      completedAt: null,
      completionReason: null,
      dispute: null,
      evidence: null,
    })
    const saved = await this.repo.save(entity).catch((error: unknown) => {
      if (isDuplicateKeyError(error))
        throw new ConflictException('MOVE_OUT_HANDOVER_EXISTS')
      throw error
    })
    await this.afterRecorded(saved, actorId)
    return saved
  }

  /** Chủ nhà sửa biên bản: tạo `revision` mới, đặt lại hạn, vô hiệu xác nhận cũ. */
  async revise(
    contractId: string,
    actorId: string,
    input: RecordMoveOutInput,
    now = new Date()
  ): Promise<MoveOutHandoverEntity> {
    const contract = await this.loadLandlordContract(contractId, actorId)
    assertMeterPhotosHosted(this.storage, input.meterPhotos)
    const current = await this.findOrFail(contractId)
    this.assertOpen(current)
    const baseline = await this.loadBaseline(contractId)
    const responseDays = resolveMoveOutResponseDays(contract.packageSnapshot)
    this.assertMeterNotBelowMoveIn(input, baseline)
    const body = this.buildBody(current.revision + 1, input, baseline)
    const handoverHash = this.hashOf(body)
    current.revisionHistory = [
      ...current.revisionHistory,
      {
        revision: current.revision,
        handoverHash: current.handoverHash,
        recordedAt: current.landlordConfirmation?.at ?? current.updatedAt,
        handedBackAt: current.handedBackAt,
        meterReadings: current.meterReadings,
        meterPhotos: current.meterPhotos ?? null,
        keyCount: current.keyCount,
        inventoryItems: current.inventoryItems,
        notes: current.notes,
      },
    ]
    current.revision = body.revision
    current.handedBackAt = new Date(input.handedBackAt)
    current.meterReadings = body.meterReadings
    current.meterPhotos = body.meterPhotos ?? null
    current.keyCount = input.keyCount
    current.inventoryItems = body.inventoryItems
    current.notes = body.notes
    current.responseDays = responseDays
    current.responseDueAt = addDays(now, responseDays)
    current.handoverHash = handoverHash
    current.recordedBy = actorId
    current.tenantConfirmation = null
    current.landlordConfirmation = { at: now, hash: handoverHash }
    const saved = await this.repo.save(current)
    await this.afterRecorded(saved, actorId)
    return saved
  }

  async confirm(
    contractId: string,
    actorId: string,
    handoverHash: string,
    now = new Date()
  ): Promise<MoveOutHandoverEntity> {
    const handover = await this.findOrFail(contractId)
    if (actorId !== handover.tenantId)
      throw new ForbiddenException('MOVE_OUT_ACCESS_DENIED')
    if (handover.status === 'completed') return handover
    this.assertOpen(handover)
    if (handover.handoverHash !== handoverHash)
      throw new ConflictException('MOVE_OUT_REVISION_STALE')
    if (this.hasOpenDiscrepancy(handover))
      throw new ConflictException('MOVE_OUT_DISCREPANCY_OPEN')
    handover.tenantConfirmation = { at: now, hash: handoverHash }
    handover.status = 'completed'
    handover.completedAt = now
    handover.completionReason = 'both-confirmed'
    const saved = await this.repo.save(handover)
    await this.afterCompleted(saved, 'tenant', actorId)
    return saved
  }

  /** Phản đối được lưu chỉ thêm; chủ nhà sửa biên bản để khách xác nhận lại. */
  async reportDiscrepancy(
    contractId: string,
    actorId: string,
    handoverHash: string,
    note: string,
    now = new Date()
  ): Promise<MoveOutHandoverEntity> {
    const handover = await this.findOrFail(contractId)
    if (actorId !== handover.tenantId)
      throw new ForbiddenException('MOVE_OUT_ACCESS_DENIED')
    this.assertOpen(handover)
    if (handover.handoverHash !== handoverHash)
      throw new ConflictException('MOVE_OUT_REVISION_STALE')
    handover.discrepancies = [
      ...handover.discrepancies,
      { revision: handover.revision, note: note.trim(), at: now },
    ]
    const saved = await this.repo.save(handover)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'move-out.handover-discrepancy-reported',
      actorRole: 'tenant',
      actorId,
      refs: { settlementId: id },
      transitionKey: `move-out:${id}:discrepancy:${saved.revision}:${saved.discrepancies.length}`,
    })
    await this.support.notify(
      [saved.landlordId],
      'Khách thuê phản đối biên bản trả nhà',
      'Khách thuê đã gửi phản đối cho biên bản trả nhà. Vui lòng xem phản hồi và sửa biên bản để khách thuê xác nhận lại.',
      this.dataOf(saved)
    )
    return saved
  }

  /** Chủ nhà hoặc khách đánh dấu tranh chấp; hệ thống không phân xử. */
  async dispute(
    contractId: string,
    actorId: string,
    note: string,
    now = new Date()
  ): Promise<MoveOutHandoverEntity> {
    const handover = await this.findOrFail(contractId)
    const by = this.partyRoleOf(handover, actorId)
    if (!by) throw new ForbiddenException('MOVE_OUT_ACCESS_DENIED')
    if (handover.status !== 'recorded')
      throw new ConflictException(
        handover.status === 'disputed'
          ? 'MOVE_OUT_HANDOVER_DISPUTED'
          : 'MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE'
      )
    handover.status = 'disputed'
    handover.dispute = { by, note: note.trim(), at: now }
    const saved = await this.repo.save(handover)
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId,
      eventType: 'move-out.handover-disputed',
      actorRole: by,
      actorId,
      refs: { settlementId: id },
      transitionKey: `move-out:${id}:disputed`,
    })
    await this.support.notify(
      [saved.tenantId, saved.landlordId],
      'Biên bản trả nhà đang có tranh chấp',
      'Một bên đã yêu cầu tranh chấp biên bản trả nhà. Hệ thống chỉ lưu chứng cứ, không phân xử.',
      this.dataOf(saved)
    )
    return saved
  }

  async getPdf(
    contractId: string,
    actorId: string,
    isStaff: boolean
  ): Promise<{ buffer: Buffer; contractCode: string }> {
    const handover = await this.findByContract(contractId, actorId, isStaff)
    if (handover.status !== 'completed')
      throw new ConflictException('MOVE_OUT_HANDOVER_NOT_COMPLETED')
    const contract = await loadContract(this.contractRepo, contractId)
    const buffer = await renderMoveOutHandoverPdf(contract, handover)
    return { buffer, contractCode: contract.contractCode }
  }

  /** Quá hạn mà khách không xác nhận cũng không phản đối → hoàn tất `tenant-no-response`. */
  async processResponseDeadlines(now = new Date()): Promise<number> {
    // ponytail: quét theo trạng thái rồi lọc trong bộ nhớ; thêm index responseDueAt nếu số hợp đồng lớn.
    const rows = await this.repo.find({ where: { status: 'recorded' } })
    let count = 0
    for (const row of rows) {
      if (new Date(row.responseDueAt) > now || this.hasOpenDiscrepancy(row))
        continue
      row.status = 'completed'
      row.completedAt = now
      row.completionReason = 'tenant-no-response'
      const saved = await this.repo.save(row)
      await this.afterCompleted(saved, 'system', null)
      count += 1
    }
    return count
  }

  private async afterRecorded(
    saved: MoveOutHandoverEntity,
    actorId: string
  ): Promise<void> {
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId: saved.contractId,
      eventType: 'move-out.handover-recorded',
      actorRole: 'landlord',
      actorId,
      refs: { settlementId: id },
      transitionKey: `move-out:${id}:recorded:${saved.revision}`,
    })
    await this.support.notify(
      [saved.tenantId],
      'Biên bản trả nhà cần bạn xác nhận',
      `Chủ nhà đã ghi biên bản trả nhà. Vui lòng xem và xác nhận hoặc phản đối trước ${saved.responseDueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}; quá hạn biên bản sẽ tự hoàn tất.`,
      this.dataOf(saved)
    )
  }

  private async afterCompleted(
    saved: MoveOutHandoverEntity,
    actorRole: 'tenant' | 'system',
    actorId: string | null
  ): Promise<void> {
    const id = saved._id.toHexString()
    await this.support.recordEvent({
      contractId: saved.contractId,
      eventType: 'move-out.handover-completed',
      actorRole,
      actorId,
      refs: { settlementId: id },
      transitionKey: `move-out:${id}:completed`,
    })
    await this.anchor(saved)
    await this.support.notify(
      [saved.tenantId, saved.landlordId],
      'Biên bản trả nhà đã hoàn tất',
      saved.completionReason === 'tenant-no-response'
        ? 'Biên bản trả nhà đã hoàn tất: khách thuê không phản hồi trong hạn.'
        : 'Biên bản trả nhà đã hoàn tất: hai bên đã xác nhận.',
      this.dataOf(saved)
    )
  }

  /** D8: neo khi hoàn tất, dùng lại action `recordHandover` với id biên bản trả nhà. */
  private async anchor(handover: MoveOutHandoverEntity): Promise<void> {
    if (!this.support.canAnchor || !handover.completedAt) return
    try {
      const id = handover._id.toHexString()
      const completedAt = new Date(handover.completedAt).toISOString()
      const envelope = buildMoveInHandoverEvidenceEnvelope({
        settlementId: id,
        contractId: handover.contractId,
        revision: handover.revision,
        handoverHash: handover.handoverHash,
        tenantConfirmationHash: handover.tenantConfirmation?.hash ?? '',
        landlordConfirmationHash: handover.landlordConfirmation?.hash ?? '',
        completedAt,
        overrideUsed: false,
        completionReason: handover.completionReason,
      })
      const manifestHash = hashMoveInHandoverEvidenceEnvelope(envelope)
      handover.evidence = pendingEvidence(envelope.schemaVersion, manifestHash)
      await this.repo.save(handover)
      await this.support.enqueueLedger({
        aggregateType: 'move-out-handover',
        aggregateId: id,
        eventType: 'move-out-handover.completed',
        action: 'recordHandover',
        args: buildHandoverArgs({
          settlementId: id,
          contractId: handover.contractId,
          handoverHash: handover.handoverHash,
          manifestSchemaVersion: envelope.schemaVersion,
          revision: handover.revision,
          overrideUsed: false,
          occurredAt: completedAt,
        }),
        contractId: handover.contractId,
        payloadHash: manifestHash,
        schemaVersion: envelope.schemaVersion,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Ledger evidence for move-out handover [${handover._id.toHexString()}] was not queued; business state is unaffected: ${message}`
      )
    }
  }

  private buildBody(
    revision: number,
    input: RecordMoveOutInput,
    baseline: Baseline
  ): {
    revision: number
    handedBackAt: string
    meterReadings: { electricity: number; water: number }
    meterPhotos?: { electricity: string[]; water: string[] }
    keyCount: number
    inventoryItems: MoveOutInventoryItem[]
    notes: string | null
  } {
    const atMoveIn = new Map(
      (baseline.inventoryItems ?? []).map(item => [nameKey(item.name), item])
    )
    const inventoryItems: MoveOutInventoryItem[] = (
      input.inventoryItems ?? []
    ).map(item => {
      const before = atMoveIn.get(nameKey(item.name))
      return {
        name: item.name,
        quantity: item.quantity,
        conditionAtMoveIn: before?.condition ?? null,
        noteAtMoveIn: before?.note ?? null,
        condition: item.condition,
        note: item.note?.trim() || null,
      }
    })
    return {
      revision,
      handedBackAt: new Date(input.handedBackAt).toISOString(),
      meterReadings: { electricity: input.electricity, water: input.water },
      // Chỉ đưa vào hash khi có ảnh công tơ, để biên bản cũ giữ nguyên hash.
      ...(input.meterPhotos ? { meterPhotos: input.meterPhotos } : {}),
      keyCount: input.keyCount,
      inventoryItems,
      notes: input.notes ?? null,
    }
  }

  /** Công tơ có thể đã được thay, nên chỉ chặn đến khi người ghi xác nhận lại. */
  private assertMeterNotBelowMoveIn(
    input: RecordMoveOutInput,
    baseline: Baseline
  ): void {
    if (input.acknowledgeMeterRegression) return
    const atMoveIn = baseline.meterReadings
    // Biên bản nhận nhà quá cũ có thể không còn chỉ số để so sánh.
    if (!atMoveIn) return
    if (
      input.electricity < atMoveIn.electricity ||
      input.water < atMoveIn.water
    ) {
      throw new ConflictException({
        code: 'METER_READING_REGRESSION',
        message:
          'Chỉ số trả nhà nhỏ hơn chỉ số nhận nhà. Vui lòng kiểm tra lại hoặc xác nhận công tơ đã được thay.',
      })
    }
  }

  private hashOf(body: object): string {
    return sha256Hex(body)
  }

  private async loadLandlordContract(
    contractId: string,
    actorId: string
  ): Promise<Contract> {
    const contract = await loadContract(this.contractRepo, contractId)
    if (actorId !== contract.landlordId)
      throw new ForbiddenException('MOVE_OUT_ACCESS_DENIED')
    if (!contract.status || !MOVE_OUT_CONTRACT_STATUSES.has(contract.status))
      throw new ConflictException('MOVE_OUT_CONTRACT_STATE_INVALID')
    return contract
  }

  private async loadBaseline(contractId: string): Promise<Baseline> {
    const settlement = await this.settlementRepo.findOne({
      where: { contractId },
    })
    const handover = settlement?.handover
    if (!handover?.completedAt)
      throw new ConflictException('MOVE_IN_HANDOVER_NOT_COMPLETED')
    return handover
  }

  private async findOrFail(contractId: string): Promise<MoveOutHandoverEntity> {
    const row = await this.repo.findOne({ where: { contractId } })
    if (!row) throw new NotFoundException('MOVE_OUT_HANDOVER_NOT_FOUND')
    return row
  }

  private assertOpen(handover: MoveOutHandoverEntity): void {
    if (handover.status === 'completed')
      throw new ConflictException('MOVE_OUT_HANDOVER_COMPLETED_IMMUTABLE')
    if (handover.status === 'disputed')
      throw new ConflictException('MOVE_OUT_HANDOVER_DISPUTED')
  }

  private hasOpenDiscrepancy(handover: MoveOutHandoverEntity): boolean {
    return handover.discrepancies.some(
      item => item.revision === handover.revision
    )
  }

  private partyRoleOf(
    handover: MoveOutHandoverEntity,
    actorId: string
  ): 'tenant' | 'landlord' | null {
    if (actorId === handover.tenantId) return 'tenant'
    if (actorId === handover.landlordId) return 'landlord'
    return null
  }

  private dataOf(handover: MoveOutHandoverEntity): Record<string, unknown> {
    return {
      contractId: handover.contractId,
      moveOutHandoverId: handover._id.toHexString(),
      revision: handover.revision,
    }
  }
}
