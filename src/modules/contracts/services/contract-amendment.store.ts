import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import { Contract, MAX_CONTRACT_AMENDMENTS } from '../schemas/contract.schema'
import {
  type ContractAmendment,
  type ContractAmendmentStatus,
  type EmbeddedContractAmendment,
} from '../schemas/contract-amendment.schema'

/** Trạng thái còn mở: tối đa một phụ lục mở mỗi hợp đồng (khớp `create()` của service). */
const OPEN_STATUSES: ContractAmendmentStatus[] = [
  'draft',
  'in-review',
  'locked',
  'pending-signature',
]

const SNAPSHOT_FIELDS = ['beforeSnapshot', 'afterSnapshot'] as const

type Doc = Record<string, unknown>

/** Điều kiện giống `FindOptionsWhere` cũ; `contractId` là khóa cha, còn lại lọc trên phần tử. */
export type ContractAmendmentWhere = Record<string, unknown>

export type ContractAmendmentOrder = Partial<
  Record<'sequence' | 'effectiveFrom' | 'createdAt', 'ASC' | 'DESC'>
>

export type ContractAmendmentFindOptions = {
  where?: ContractAmendmentWhere | ContractAmendmentWhere[]
  order?: ContractAmendmentOrder
  /** Liệt kê: bỏ `beforeSnapshot`/`afterSnapshot` khỏi kết quả (giảm dữ liệu trả về). */
  omitSnapshots?: boolean
}

type ContractRow = { _id: ObjectId; amendments?: EmbeddedContractAmendment[] }

/**
 * Kho phụ lục nhúng `Contract.amendments[]` (G-AMD). Giữ đúng dáng API của repository
 * cũ (`find`, `findOne`, `create`, `save`) để service giữ nguyên logic:
 * - Đọc: aggregate trên `contracts` (không qua entity, vì `Contract` bỏ mảng khi nạp).
 * - Ghi phần tử đã có: `updateOne` `$set` vị trí `amendments.$` chỉ các trường đổi.
 * - Thêm phần tử mới: `updateOne` `$push` có điều kiện nguyên tử: trần số phụ lục,
 *   không trùng `sequence`, không trùng `idempotencyKey`, không có phụ lục mở khác.
 * Không bao giờ `save` toàn hợp đồng nên không đè mảng phụ lục.
 */
@Injectable()
export class ContractAmendmentStore {
  /** Phụ lục vừa `create()` và chưa `save()`: `save` sẽ thêm mới (`$push`). */
  private readonly pendingInsert = new WeakSet<ContractAmendment>()
  /** JSON từng trường lúc nạp/lưu gần nhất, để chỉ `$set` các trường đã đổi. */
  private readonly loadedFields = new WeakMap<
    ContractAmendment,
    Record<string, string>
  >()

  constructor(
    @InjectRepository(Contract)
    private readonly contracts: MongoRepository<Contract>
  ) {}

  async findOne(options: {
    where: ContractAmendmentWhere | ContractAmendmentWhere[]
    omitSnapshots?: boolean
  }): Promise<ContractAmendment | null> {
    const items = await this.find(options)
    return items[0] ?? null
  }

  async find(
    options: ContractAmendmentFindOptions = {}
  ): Promise<ContractAmendment[]> {
    const branches = Array.isArray(options.where)
      ? options.where
      : [options.where ?? {}]
    const byId = new Map<string, ContractAmendment>()
    for (const branch of branches) {
      for (const item of await this.findBranch(branch, options.omitSnapshots)) {
        byId.set(item._id.toHexString(), item)
      }
    }
    const items = [...byId.values()]
    const order = options.order ?? {}
    const sortKeys = Object.entries(order) as Array<
      [keyof ContractAmendmentOrder, 'ASC' | 'DESC']
    >
    if (sortKeys.length > 0) {
      items.sort((a, b) => {
        for (const [key, dir] of sortKeys) {
          const av = sortValue(a[key])
          const bv = sortValue(b[key])
          if (av === bv) continue
          const cmp = av < bv ? -1 : 1
          return dir === 'DESC' ? -cmp : cmp
        }
        return 0
      })
    }
    return items
  }

  /** Phụ lục mới (chưa ghi). `save()` sẽ thêm vào mảng của hợp đồng. */
  create(input: Partial<ContractAmendment>): ContractAmendment {
    const item = { _id: new ObjectId(), ...input } as ContractAmendment
    this.pendingInsert.add(item)
    return item
  }

  async save(entity: ContractAmendment): Promise<ContractAmendment> {
    const contractOid = toContractOid(entity.contractId)
    if (this.pendingInsert.has(entity)) {
      return this.insert(contractOid, entity)
    }
    return this.update(contractOid, entity)
  }

  private async findBranch(
    where: ContractAmendmentWhere,
    omitSnapshots?: boolean
  ): Promise<ContractAmendment[]> {
    const { contractId, ...elementWhere } = where
    const parentFilter: Doc = {}
    if (contractId instanceof ObjectId) {
      parentFilter._id = contractId
    } else if (contractId !== undefined && contractId !== null) {
      if (typeof contractId !== 'string' || !ObjectId.isValid(contractId)) {
        return []
      }
      parentFilter._id = new ObjectId(contractId)
    }
    const elementFilter: Doc = {}
    for (const [key, value] of Object.entries(elementWhere)) {
      if (value !== undefined) elementFilter[key] = value
    }
    if (Object.keys(elementFilter).length > 0) {
      parentFilter.amendments = { $elemMatch: elementFilter }
    }

    const rows = (await this.contracts
      .aggregate([{ $match: parentFilter }, { $project: { amendments: 1 } }])
      .toArray()) as unknown as ContractRow[]

    const out: ContractAmendment[] = []
    for (const row of rows) {
      for (const element of row.amendments ?? []) {
        if (!matchesElement(element, elementWhere)) continue
        const item = {
          ...element,
          contractId: row._id.toHexString(),
        }
        if (omitSnapshots) {
          for (const field of SNAPSHOT_FIELDS)
            delete (item as unknown as Doc)[field]
        }
        this.remember(item)
        out.push(item)
      }
    }
    return out
  }

  private async update(
    contractOid: ObjectId,
    entity: ContractAmendment
  ): Promise<ContractAmendment> {
    const loaded = this.loadedFields.get(entity)
    const $set: Doc = {}
    for (const [key, value] of Object.entries(entity as unknown as Doc)) {
      if (key === '_id' || key === 'contractId' || value === undefined) continue
      const json = toJson(value)
      if (loaded && loaded[key] === json) continue
      $set[`amendments.$.${key}`] = value
    }
    if (Object.keys($set).length === 0) return entity
    entity.updatedAt = new Date()
    $set['amendments.$.updatedAt'] = entity.updatedAt

    const result = await this.contracts.updateOne(
      { _id: contractOid, 'amendments._id': entity._id },
      { $set }
    )
    if (result.matchedCount === 0) {
      throw new NotFoundException('CONTRACT_AMENDMENT_NOT_FOUND')
    }
    this.remember(entity)
    return entity
  }

  private async insert(
    contractOid: ObjectId,
    entity: ContractAmendment
  ): Promise<ContractAmendment> {
    const now = new Date()
    if (!entity.createdAt) entity.createdAt = now
    entity.updatedAt = now

    const element: Doc = {}
    for (const [key, value] of Object.entries(entity as unknown as Doc)) {
      if (key === 'contractId' || value === undefined) continue
      element[key] = value
    }

    const filter: Doc = {
      _id: contractOid,
      [`amendments.${MAX_CONTRACT_AMENDMENTS - 1}`]: { $exists: false },
      'amendments.sequence': { $ne: entity.sequence },
    }
    if (entity.idempotencyKey) {
      filter['amendments.idempotencyKey'] = { $ne: entity.idempotencyKey }
    }
    if (OPEN_STATUSES.includes(entity.status)) {
      filter.amendments = {
        $not: { $elemMatch: { status: { $in: OPEN_STATUSES } } },
      }
    }

    const result = await this.contracts.updateOne(filter, {
      $push: { amendments: element },
    } as never)
    if (result.matchedCount === 0) {
      await this.throwInsertConflict(contractOid, entity)
    }
    this.pendingInsert.delete(entity)
    this.remember(entity)
    return entity
  }

  private async throwInsertConflict(
    contractOid: ObjectId,
    entity: ContractAmendment
  ): Promise<never> {
    const rows = (await this.contracts
      .aggregate([
        { $match: { _id: contractOid } },
        { $project: { amendments: 1 } },
      ])
      .toArray()) as unknown as ContractRow[]
    if (rows.length === 0) throw new NotFoundException('CONTRACT_NOT_FOUND')
    const [row] = rows
    const list = row?.amendments ?? []
    if (list.length >= MAX_CONTRACT_AMENDMENTS) {
      throw new ConflictException('CONTRACT_AMENDMENT_LIMIT_REACHED')
    }
    if (
      OPEN_STATUSES.includes(entity.status) &&
      list.some(item => OPEN_STATUSES.includes(item.status))
    ) {
      throw new ConflictException('CONTRACT_AMENDMENT_IN_PROGRESS')
    }
    throw new ConflictException('CONTRACT_AMENDMENT_SEQUENCE_CONFLICT')
  }

  private remember(entity: ContractAmendment): void {
    const fields: Record<string, string> = {}
    for (const [key, value] of Object.entries(entity as unknown as Doc)) {
      if (value === undefined) continue
      fields[key] = toJson(value)
    }
    this.loadedFields.set(entity, fields)
  }
}

function toContractOid(contractId: unknown): ObjectId {
  if (!ObjectId.isValid(String(contractId))) {
    throw new NotFoundException('CONTRACT_NOT_FOUND')
  }
  return new ObjectId(String(contractId))
}

function toJson(value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

function sortValue(value: unknown): number | string {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' || typeof value === 'string') return value
  return 0
}

function matchesElement(element: Doc, where: Doc): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true
    const actual = element[key]
    if (expected instanceof ObjectId) {
      return actual instanceof ObjectId && actual.equals(expected)
    }
    if (expected === null) return actual === null || actual === undefined
    if (actual instanceof Date && expected instanceof Date) {
      return actual.getTime() === expected.getTime()
    }
    return actual === expected
  })
}
