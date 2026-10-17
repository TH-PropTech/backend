/**
 * Chuẩn hoá `layout` của thiết kế 3D căn hộ (bố cục tuỳ chỉnh). Cài lại đúng luật của
 * `apartment-3d-renderer/src/data/layoutSchema.js`; fixture `layout-cases.json` dùng chung kiểm tra tính tương đương.
 * Bản sao đồng nhất nằm ở frontend (`model/apartment-layout.ts`) và mobile (`apartment-layout.ts`).
 */
export const LAYOUT_FURNITURE_KINDS = [
  'sofa',
  'armchair',
  'ottoman',
  'coffeeTable',
  'sideTable',
  'tvUnit',
  'bookshelf',
  'dresser',
  'wardrobe',
  'bed',
  'nightstand',
  'desk',
  'chair',
  'diningTable',
  'barStool',
  'console',
  'plant',
  'floorLamp',
  'standingMirror',
  'rug',
  'kitchenRun',
  'fridge',
  'toilet',
  'vanity',
  'shower',
] as const
export type LayoutFurnitureKind = (typeof LAYOUT_FURNITURE_KINDS)[number]

export const LAYOUT_FLOOR_MATERIALS = [
  'wood',
  'darkwood',
  'tile',
  'marble',
  'granite',
  'concrete',
  'epoxy',
  'carpet',
  'glass',
] as const
export type LayoutFloorMaterial = (typeof LAYOUT_FLOOR_MATERIALS)[number]

export const LAYOUT_OPENING_TYPES = ['window', 'door', 'open'] as const
export type LayoutOpeningType = (typeof LAYOUT_OPENING_TYPES)[number]

export const LAYOUT_LIMITS = {
  overrides: 120,
  extras: 60,
  floors: 5,
  roomsPerFloor: 24,
  openingsPerFloor: 60,
  coordMin: -2,
  coordMax: 40,
  roomMin: 1.2,
  roomMax: 40,
  openingMin: 0.5,
  openingMax: 4,
  sillMax: 2.4,
  nameMax: 40,
} as const

const ID_PATTERN = /^[A-Za-z0-9_-]{1,48}$/

export interface LayoutItemOverride {
  x?: number
  z?: number
  rot?: number
  hidden?: boolean
}

export interface LayoutExtra {
  id: string
  kind: LayoutFurnitureKind
  x: number
  z: number
  rot: number
  args?: number[]
  hidden?: boolean
  floor?: string
}

export interface LayoutRoomOverride {
  name?: string
  floor?: LayoutFloorMaterial
}

export interface LayoutOpening {
  id: string
  dir: 'x' | 'z'
  at: number
  c: number
  w: number
  type: LayoutOpeningType
  sill?: number
  entrance?: true
}

export interface LayoutOpeningPatch {
  c?: number
  w?: number
  type?: LayoutOpeningType
}

export interface LayoutOpeningOverrides {
  removed: string[]
  moved: Record<string, LayoutOpeningPatch>
  added: LayoutOpening[]
}

export interface LayoutCustomRoom {
  id: string
  name: string
  x0: number
  x1: number
  z0: number
  z1: number
  floor: LayoutFloorMaterial
}

export interface LayoutCustomFloor {
  id: string
  name: string
  rooms: LayoutCustomRoom[]
  openings: LayoutOpening[]
}

export interface ApartmentLayout {
  items: Record<string, LayoutItemOverride>
  extras: LayoutExtra[]
  rooms?: Record<string, LayoutRoomOverride>
  openings?: LayoutOpeningOverrides
  custom?: { floors: LayoutCustomFloor[] }
}

type Rec = Record<string, unknown>

const round = (v: number, p: number): number => Math.round(v * p) / p
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const isRec = (v: unknown): v is Rec =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const okId = (v: unknown): v is string =>
  typeof v === 'string' && ID_PATTERN.test(v)

const coord = (v: unknown): number | undefined =>
  isNum(v) && v >= LAYOUT_LIMITS.coordMin && v <= LAYOUT_LIMITS.coordMax
    ? round(v, 1000)
    : undefined
const angle = (v: unknown): number | undefined =>
  isNum(v) ? round(v % (Math.PI * 2), 10000) : undefined
const cleanName = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim()
    ? v.trim().slice(0, LAYOUT_LIMITS.nameMax)
    : undefined
const material = (v: unknown): LayoutFloorMaterial | undefined =>
  (LAYOUT_FLOOR_MATERIALS as readonly unknown[]).includes(v)
    ? (v as LayoutFloorMaterial)
    : undefined
const openingType = (v: unknown): LayoutOpeningType | undefined =>
  (LAYOUT_OPENING_TYPES as readonly unknown[]).includes(v)
    ? (v as LayoutOpeningType)
    : undefined
const openingWidth = (v: unknown): number | undefined =>
  isNum(v) && v >= LAYOUT_LIMITS.openingMin && v <= LAYOUT_LIMITS.openingMax
    ? round(v, 100)
    : undefined

function extraArgs(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 3) return undefined
  const out = v.map(n =>
    isNum(n) && n >= 0.2 && n <= 8 ? round(n, 100) : null
  )
  return out.every(n => n !== null) ? out : undefined
}

export function normalizeOpening(raw: unknown): LayoutOpening | null {
  if (!isRec(raw) || !okId(raw.id)) return null
  if (raw.dir !== 'x' && raw.dir !== 'z') return null
  const at = coord(raw.at)
  const c = coord(raw.c)
  const w = openingWidth(raw.w)
  const type = openingType(raw.type)
  if (at === undefined || c === undefined || w === undefined || !type)
    return null
  const out: LayoutOpening = { id: raw.id, dir: raw.dir, at, c, w, type }
  if (
    type === 'window' &&
    isNum(raw.sill) &&
    raw.sill >= 0 &&
    raw.sill <= LAYOUT_LIMITS.sillMax
  )
    out.sill = round(raw.sill, 100)
  if (type === 'door' && raw.entrance === true) out.entrance = true
  return out
}

export function normalizeRoom(raw: unknown): LayoutCustomRoom | null {
  if (!isRec(raw) || !okId(raw.id)) return null
  const name = cleanName(raw.name)
  const x0 = coord(raw.x0)
  const x1 = coord(raw.x1)
  const z0 = coord(raw.z0)
  const z1 = coord(raw.z1)
  if (
    !name ||
    x0 === undefined ||
    x1 === undefined ||
    z0 === undefined ||
    z1 === undefined ||
    [x0, x1, z0, z1].some(v => v < 0)
  )
    return null
  const w = x1 - x0
  const d = z1 - z0
  const { roomMin, roomMax } = LAYOUT_LIMITS
  if (w < roomMin - 1e-9 || d < roomMin - 1e-9 || w > roomMax || d > roomMax)
    return null
  return {
    id: raw.id,
    name,
    x0,
    x1,
    z0,
    z1,
    floor: material(raw.floor) ?? 'wood',
  }
}

export const roomsOverlap = (
  a: LayoutCustomRoom,
  b: LayoutCustomRoom
): boolean =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 &&
  Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01

function normalizeFloor(raw: unknown): LayoutCustomFloor | null {
  if (!isRec(raw) || !okId(raw.id)) return null
  const rooms: LayoutCustomRoom[] = []
  const roomIds = new Set<string>()
  const rawRooms = Array.isArray(raw.rooms) ? raw.rooms : []
  for (const r of rawRooms.slice(0, LAYOUT_LIMITS.roomsPerFloor)) {
    const room = normalizeRoom(r)
    if (
      !room ||
      roomIds.has(room.id) ||
      rooms.some(other => roomsOverlap(room, other))
    )
      continue
    roomIds.add(room.id)
    rooms.push(room)
  }
  if (!rooms.length) return null
  const openings: LayoutOpening[] = []
  const openingIds = new Set<string>()
  const rawOpenings = Array.isArray(raw.openings) ? raw.openings : []
  for (const o of rawOpenings.slice(0, LAYOUT_LIMITS.openingsPerFloor)) {
    const opening = normalizeOpening(o)
    if (!opening || openingIds.has(opening.id)) continue
    openingIds.add(opening.id)
    openings.push(opening)
  }
  return { id: raw.id, name: cleanName(raw.name) ?? 'Tầng', rooms, openings }
}

export function normalizeCustom(
  raw: unknown
): { floors: LayoutCustomFloor[] } | null {
  if (!isRec(raw) || !Array.isArray(raw.floors)) return null
  const floors: LayoutCustomFloor[] = []
  const ids = new Set<string>()
  for (const f of raw.floors.slice(0, LAYOUT_LIMITS.floors)) {
    const floor = normalizeFloor(f)
    if (!floor || ids.has(floor.id)) continue
    ids.add(floor.id)
    floors.push(floor)
  }
  return floors.length ? { floors } : null
}

function normalizeRoomOverrides(
  raw: unknown
): Record<string, LayoutRoomOverride> {
  const out: Record<string, LayoutRoomOverride> = {}
  if (!isRec(raw)) return out
  for (const [id, value] of Object.entries(raw).slice(
    0,
    LAYOUT_LIMITS.overrides
  )) {
    if (!okId(id) || !isRec(value)) continue
    const entry: LayoutRoomOverride = {}
    const name = cleanName(value.name)
    const floor = material(value.floor)
    if (name) entry.name = name
    if (floor) entry.floor = floor
    if (Object.keys(entry).length) out[id] = entry
  }
  return out
}

function normalizeOpeningOverrides(raw: unknown): LayoutOpeningOverrides {
  const out: LayoutOpeningOverrides = { removed: [], moved: {}, added: [] }
  if (!isRec(raw)) return out
  if (Array.isArray(raw.removed)) {
    for (const id of raw.removed.slice(0, LAYOUT_LIMITS.overrides)) {
      if (okId(id) && !out.removed.includes(id)) out.removed.push(id)
    }
  }
  if (isRec(raw.moved)) {
    for (const [id, value] of Object.entries(raw.moved).slice(
      0,
      LAYOUT_LIMITS.overrides
    )) {
      if (!okId(id) || !isRec(value)) continue
      const entry: LayoutOpeningPatch = {}
      const c = coord(value.c)
      const w = openingWidth(value.w)
      const type = openingType(value.type)
      if (c !== undefined) entry.c = c
      if (w !== undefined) entry.w = w
      if (type) entry.type = type
      if (Object.keys(entry).length) out.moved[id] = entry
    }
  }
  if (Array.isArray(raw.added)) {
    const seen = new Set<string>()
    for (const o of raw.added.slice(0, LAYOUT_LIMITS.openingsPerFloor)) {
      const opening = normalizeOpening(o)
      if (!opening || seen.has(opening.id)) continue
      seen.add(opening.id)
      out.added.push(opening)
    }
  }
  return out
}

export function normalizeApartmentLayout(raw: unknown): ApartmentLayout {
  const out: ApartmentLayout = { items: {}, extras: [] }
  if (!isRec(raw)) return out

  if (isRec(raw.items)) {
    for (const [id, o] of Object.entries(raw.items).slice(
      0,
      LAYOUT_LIMITS.overrides
    )) {
      if (!okId(id) || !isRec(o)) continue
      const entry: LayoutItemOverride = {}
      const x = coord(o.x)
      const z = coord(o.z)
      const rot = angle(o.rot)
      if (x !== undefined) entry.x = x
      if (z !== undefined) entry.z = z
      if (rot !== undefined) entry.rot = rot
      if (o.hidden === true) entry.hidden = true
      if (Object.keys(entry).length) out.items[id] = entry
    }
  }

  if (Array.isArray(raw.extras)) {
    const seen = new Set<string>()
    for (const e of raw.extras.slice(0, LAYOUT_LIMITS.extras)) {
      if (!isRec(e) || !okId(e.id) || seen.has(e.id)) continue
      if (!(LAYOUT_FURNITURE_KINDS as readonly unknown[]).includes(e.kind))
        continue
      const x = coord(e.x)
      const z = coord(e.z)
      if (x === undefined || z === undefined) continue
      seen.add(e.id)
      const extra: LayoutExtra = {
        id: e.id,
        kind: e.kind as LayoutFurnitureKind,
        x,
        z,
        rot: angle(e.rot) ?? 0,
      }
      const args = extraArgs(e.args)
      if (args) extra.args = args
      if (e.hidden === true) extra.hidden = true
      if (okId(e.floor)) extra.floor = e.floor
      out.extras.push(extra)
    }
  }

  const rooms = normalizeRoomOverrides(raw.rooms)
  if (Object.keys(rooms).length) out.rooms = rooms
  const openings = normalizeOpeningOverrides(raw.openings)
  if (
    openings.removed.length ||
    Object.keys(openings.moved).length ||
    openings.added.length
  )
    out.openings = openings
  const custom = normalizeCustom(raw.custom)
  if (custom) out.custom = custom
  return out
}

export const isApartmentLayoutEmpty = (layout: ApartmentLayout): boolean =>
  Object.keys(layout.items).length === 0 &&
  layout.extras.length === 0 &&
  !layout.rooms &&
  !layout.openings &&
  !layout.custom
