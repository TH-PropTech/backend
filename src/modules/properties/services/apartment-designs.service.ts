import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Document, PushOperator } from 'mongodb'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import {
  Apartment,
  APARTMENT_FURNITURE_KINDS,
  APARTMENT_LAYOUT_COORD_MAX,
  APARTMENT_LAYOUT_COORD_MIN,
  MAX_APARTMENT_DESIGNS,
  MAX_APARTMENT_LAYOUT_EXTRAS,
  MAX_APARTMENT_LAYOUT_ITEMS,
  type ApartmentDesignEntry,
  type ApartmentDesignLayout,
  type ApartmentDesignLayoutExtra,
  type ApartmentDesignLayoutItem,
  type ApartmentDesignPalette,
} from '../schemas/apartment.schema'
import type {
  CreateApartmentDesignDto,
  UpdateApartmentDesignDto,
} from '../dto/apartment-design.dto'

/** Dạng trả cho người xem (chỉ thiết kế đang bật, không lộ thông tin quản trị). */
export interface PublicApartmentDesign {
  id: string
  name: string
  description: string
  theme: ApartmentDesignEntry['theme']
  palette: ApartmentDesignPalette
  furnishing: ApartmentDesignEntry['furnishing']
  defaultHour: number
  layout: ApartmentDesignLayout
}

/** Dạng trả cho admin: thêm trạng thái hiển thị + thứ tự. */
export interface AdminApartmentDesign extends PublicApartmentDesign {
  visible: boolean
  order: number
  updatedAt: Date
}

function cleanPalette(
  palette: ApartmentDesignPalette | undefined
): ApartmentDesignPalette {
  const out: ApartmentDesignPalette = {}
  if (!palette) return out
  for (const key of ['floor', 'wall', 'wood', 'sofa', 'accent'] as const) {
    const value = palette[key]
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      out[key] = value.toLowerCase()
    }
  }
  return out
}

const LAYOUT_ID = /^[A-Za-z0-9_-]{1,48}$/
const FURNITURE_KINDS = new Set<string>(APARTMENT_FURNITURE_KINDS)

function cleanCoordinate(value: unknown): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < APARTMENT_LAYOUT_COORD_MIN ||
    value > APARTMENT_LAYOUT_COORD_MAX
  )
    return undefined
  return Math.round(value * 1000) / 1000
}

function cleanRotation(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.round((value % (Math.PI * 2)) * 10000) / 10000
}

function cleanLayoutItem(value: unknown): ApartmentDesignLayoutItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const item: ApartmentDesignLayoutItem = {}
  const x = cleanCoordinate(raw.x)
  const z = cleanCoordinate(raw.z)
  const rot = cleanRotation(raw.rot)
  if (x !== undefined) item.x = x
  if (z !== undefined) item.z = z
  if (rot !== undefined) item.rot = rot
  if (raw.hidden === true) item.hidden = true
  return Object.keys(item).length > 0 ? item : null
}

function cleanLayout(value: unknown): ApartmentDesignLayout {
  const output: ApartmentDesignLayout = { items: {}, extras: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output
  const raw = value as Record<string, unknown>
  if (raw.items && typeof raw.items === 'object' && !Array.isArray(raw.items)) {
    for (const [id, value] of Object.entries(raw.items).slice(
      0,
      MAX_APARTMENT_LAYOUT_ITEMS
    )) {
      if (!LAYOUT_ID.test(id)) continue
      const item = cleanLayoutItem(value)
      if (item) output.items[id] = item
    }
  }
  if (!Array.isArray(raw.extras)) return output
  const seen = new Set<string>()
  for (const value of raw.extras.slice(0, MAX_APARTMENT_LAYOUT_EXTRAS)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const extra = value as Record<string, unknown>
    if (
      typeof extra.id !== 'string' ||
      !LAYOUT_ID.test(extra.id) ||
      seen.has(extra.id) ||
      typeof extra.kind !== 'string' ||
      !FURNITURE_KINDS.has(extra.kind)
    )
      continue
    const x = cleanCoordinate(extra.x)
    const z = cleanCoordinate(extra.z)
    if (x === undefined || z === undefined) continue
    const normalized: ApartmentDesignLayoutExtra = {
      id: extra.id,
      kind: extra.kind as ApartmentDesignLayoutExtra['kind'],
      x,
      z,
      rot: cleanRotation(extra.rot) ?? 0,
    }
    if (extra.hidden === true) normalized.hidden = true
    seen.add(normalized.id)
    output.extras.push(normalized)
  }
  return output
}

function toPublic(entry: ApartmentDesignEntry): PublicApartmentDesign {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description ?? '',
    theme: entry.theme,
    palette: entry.palette ?? {},
    furnishing: entry.furnishing ?? null,
    defaultHour: entry.defaultHour,
    layout: cleanLayout(entry.layout),
  }
}

function toAdmin(entry: ApartmentDesignEntry): AdminApartmentDesign {
  return {
    ...toPublic(entry),
    visible: entry.visible,
    order: entry.order,
    updatedAt: entry.updatedAt,
  }
}

const byOrder = (a: ApartmentDesignEntry, b: ApartmentDesignEntry): number =>
  a.order - b.order || a.name.localeCompare(b.name, 'vi')

/**
 * Thiết kế 3D nhúng trong `Apartment.floorplanDesigns[]`. Ghi chỉ bằng `updateOne` nguyên tử
 * ($push có trần / $set vị trí / $pull): `Apartment` bị `save` nguyên document ở nhiều nơi nên không
 * được đọc-rồi-ghi mảng này. Căn hộ chưa có thiết kế nào thì viewer tự dùng thiết kế mặc định.
 */
@Injectable()
export class ApartmentDesignsService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: MongoRepository<Apartment>
  ) {}

  /** Người xem: chỉ thiết kế đang hiện, đã sắp thứ tự. */
  async listVisible(apartmentId: string): Promise<PublicApartmentDesign[]> {
    const all = await this.load(apartmentId)
    return all
      .filter(entry => entry.visible)
      .sort(byOrder)
      .map(toPublic)
  }

  /** Admin: toàn bộ thiết kế kể cả đang ẩn. */
  async listAll(apartmentId: string): Promise<AdminApartmentDesign[]> {
    const all = await this.load(apartmentId)
    return all.sort(byOrder).map(toAdmin)
  }

  async create(
    apartmentId: string,
    dto: CreateApartmentDesignDto,
    actorId: string
  ): Promise<AdminApartmentDesign> {
    const _id = this.toObjectId(apartmentId)
    const existing = await this.load(apartmentId)
    const now = new Date()
    const entry: ApartmentDesignEntry = {
      id: new ObjectId().toHexString(),
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      theme: dto.theme,
      palette: cleanPalette(dto.palette),
      furnishing: dto.furnishing ?? null,
      defaultHour: dto.defaultHour ?? 10,
      layout: cleanLayout(dto.layout),
      visible: dto.visible ?? true,
      order: dto.order ?? existing.length,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    }
    if (!entry.name)
      throw new BadRequestException('Tên thiết kế không được trống')

    const result = await this.apartmentRepository.updateOne(
      {
        _id,
        [`floorplanDesigns.${MAX_APARTMENT_DESIGNS - 1}`]: { $exists: false },
      },
      {
        $push: {
          floorplanDesigns: entry,
        } as unknown as PushOperator<Document>,
      }
    )
    if (result.matchedCount === 0) {
      throw new ConflictException(
        `Căn hộ đã đạt tối đa ${MAX_APARTMENT_DESIGNS} thiết kế`
      )
    }
    return toAdmin(entry)
  }

  async update(
    apartmentId: string,
    designId: string,
    dto: UpdateApartmentDesignDto
  ): Promise<AdminApartmentDesign> {
    const _id = this.toObjectId(apartmentId)
    const set: Record<string, unknown> = {
      'floorplanDesigns.$.updatedAt': new Date(),
    }
    if (dto.name !== undefined) {
      const name = dto.name.trim()
      if (!name) throw new BadRequestException('Tên thiết kế không được trống')
      set['floorplanDesigns.$.name'] = name
    }
    if (dto.description !== undefined) {
      set['floorplanDesigns.$.description'] = dto.description.trim()
    }
    if (dto.theme !== undefined) set['floorplanDesigns.$.theme'] = dto.theme
    if (dto.palette !== undefined) {
      set['floorplanDesigns.$.palette'] = cleanPalette(dto.palette)
    }
    if (dto.furnishing !== undefined) {
      set['floorplanDesigns.$.furnishing'] = dto.furnishing
    }
    if (dto.defaultHour !== undefined) {
      set['floorplanDesigns.$.defaultHour'] = dto.defaultHour
    }
    if (dto.layout !== undefined) {
      set['floorplanDesigns.$.layout'] = cleanLayout(dto.layout)
    }
    if (dto.visible !== undefined)
      set['floorplanDesigns.$.visible'] = dto.visible
    if (dto.order !== undefined) set['floorplanDesigns.$.order'] = dto.order

    const result = await this.apartmentRepository.updateOne(
      { _id, 'floorplanDesigns.id': designId },
      { $set: set }
    )
    if (result.matchedCount === 0) {
      throw new NotFoundException('Không tìm thấy thiết kế')
    }
    const updated = (await this.load(apartmentId)).find(e => e.id === designId)
    if (!updated) throw new NotFoundException('Không tìm thấy thiết kế')
    return toAdmin(updated)
  }

  async remove(apartmentId: string, designId: string): Promise<void> {
    const _id = this.toObjectId(apartmentId)
    const result = await this.apartmentRepository.updateOne(
      { _id, 'floorplanDesigns.id': designId },
      { $pull: { floorplanDesigns: { id: designId } } as never }
    )
    if (result.matchedCount === 0) {
      throw new NotFoundException('Không tìm thấy thiết kế')
    }
  }

  private async load(apartmentId: string): Promise<ApartmentDesignEntry[]> {
    const _id = this.toObjectId(apartmentId)
    const rows = (await this.apartmentRepository
      .aggregate([{ $match: { _id } }, { $project: { floorplanDesigns: 1 } }])
      .toArray()) as Array<{ floorplanDesigns?: ApartmentDesignEntry[] }>
    if (rows.length === 0) throw new NotFoundException('Không tìm thấy căn hộ')
    return [...(rows[0]?.floorplanDesigns ?? [])]
  }

  private toObjectId(id: string): ObjectId {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException('Mã căn hộ không hợp lệ')
    }
    return new ObjectId(id)
  }
}
