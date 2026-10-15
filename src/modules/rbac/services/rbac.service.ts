import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import type {
  CreateRoleDto,
  PermissionInputDto,
  UpdateRoleDto,
} from '../dto/rbac.dto'
import {
  DEFAULT_ROLES,
  RBAC_ACTIONS,
  RBAC_SUBJECTS,
  type DefaultPermission,
  type DefaultRole,
} from '../rbac.constants'
import { Role } from '../schemas/role.schema'
import type {
  RolePermission,
  RolePermissionView,
  RoleView,
} from '../schemas/role.schema'

/** Cột của role, bỏ `permissions` (đọc danh sách/chi tiết role không cần quyền nhúng). */
const ROLE_FIELDS_WITHOUT_PERMISSIONS = [
  '_id',
  'name',
  'description',
  'isActive',
  'isSystem',
  'createdAt',
  'updatedAt',
] as const

const permKey = (action: string, subject: string): string =>
  `${action}:${subject}`

/** Khử trùng (action, subject), giữ vị trí lần đầu và giá trị lần cuối (như Map cũ). */
function uniqueByKey<T extends { action: string; subject: string }>(
  list: readonly T[]
): Map<string, T> {
  const unique = new Map<string, T>()
  for (const p of list) unique.set(permKey(p.action, p.subject), p)
  return unique
}

function toRoleView(role: Role): RoleView {
  const view: Partial<Role> = { ...role }
  delete view.permissions
  return view as RoleView
}

function toPermissionViews(
  roleId: string,
  list: readonly RolePermission[] | undefined
): RolePermissionView[] {
  return (list ?? []).map(p => ({
    _id: p._id,
    roleId,
    action: p.action,
    subject: p.subject,
    allowed: p.allowed,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }))
}

/** Quyền nhúng mới cho một danh sách mặc định/đầu vào (khử trùng, `_id` mới). */
function newEmbedded(
  list: readonly (DefaultPermission | PermissionInputDto)[],
  now: Date
): RolePermission[] {
  return [...uniqueByKey(list).values()].map(p => ({
    _id: new ObjectId(),
    action: p.action,
    subject: p.subject,
    allowed: p.allowed,
    createdAt: now,
    updatedAt: now,
  }))
}

function matched(result: unknown): boolean {
  return ((result as { matchedCount?: number } | null)?.matchedCount ?? 0) > 0
}

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name)

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: MongoRepository<Role>
  ) {}

  /** Seed role mặc định; lỗi DB chỉ được ghi log, không làm app sập. */
  async onModuleInit(): Promise<void> {
    try {
      const created = await this.seedDefaults()
      if (created.length > 0) {
        this.logger.log(`Seeded default roles: ${created.join(', ')}`)
      }
    } catch (err) {
      this.logger.error(
        'Seed role mặc định thất bại (bỏ qua)',
        err instanceof Error ? err.stack : String(err)
      )
    }
  }

  /**
   * Idempotent: chỉ tạo role còn thiếu (theo name) cùng quyền mặc định của nó,
   * ghi trong MỘT lần insert. Role đã tồn tại (kể cả đã bị admin chỉnh quyền)
   * không bị ghi đè.
   * @returns tên các role vừa được tạo
   */
  async seedDefaults(
    defaults: DefaultRole[] = DEFAULT_ROLES
  ): Promise<string[]> {
    const created: string[] = []
    for (const def of defaults) {
      const existing = await this.roleRepository.findOne({
        where: { name: def.name },
      })
      if (existing) continue

      await this.roleRepository.save(
        this.roleRepository.create({
          name: def.name,
          description: def.description,
          isActive: true,
          isSystem: true,
          permissions: newEmbedded(def.permissions, new Date()),
        })
      )
      created.push(def.name)
    }
    return created
  }

  getMetadata(): { actions: readonly string[]; subjects: readonly string[] } {
    return { actions: RBAC_ACTIONS, subjects: RBAC_SUBJECTS }
  }

  // ───────────── Role ─────────────

  listRoles(): Promise<RoleView[]> {
    return this.roleRepository.find({
      select: [...ROLE_FIELDS_WITHOUT_PERMISSIONS] as (keyof Role)[],
      order: { name: 'ASC' },
    })
  }

  async getRole(id: string): Promise<RoleView> {
    return toRoleView(await this.findRole(id))
  }

  async createRole(dto: CreateRoleDto): Promise<RoleView> {
    await this.assertNameAvailable(dto.name)
    const saved = await this.roleRepository.save(
      this.roleRepository.create({
        name: dto.name,
        description: dto.description ?? '',
        isActive: true,
        isSystem: false,
        permissions: [],
      })
    )
    return toRoleView(saved)
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const role = await this.findRole(id)
    const set: Partial<Pick<Role, 'name' | 'description' | 'isActive'>> = {}
    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem) {
        throw new BadRequestException('Không thể đổi tên role mặc định')
      }
      await this.assertNameAvailable(dto.name)
      role.name = dto.name
      set.name = dto.name
    }
    if (dto.description !== undefined) {
      role.description = dto.description
      set.description = dto.description
    }
    if (dto.isActive !== undefined) {
      role.isActive = dto.isActive
      set.isActive = dto.isActive
    }
    // Chỉ $set trường thân: không bao giờ ghi đè `permissions` nhúng.
    role.updatedAt = new Date()
    await this.roleRepository.updateOne(
      { _id: role._id },
      { $set: { ...set, updatedAt: role.updatedAt } }
    )
    return toRoleView(role)
  }

  async deleteRole(id: string): Promise<{ deleted: true }> {
    const role = await this.findRole(id)
    if (role.isSystem) {
      throw new BadRequestException('Không thể xóa role mặc định')
    }
    await this.roleRepository.delete(role._id)
    return { deleted: true }
  }

  // ───────────── Permission ─────────────

  async getPermissions(roleId: string): Promise<RolePermissionView[]> {
    const role = await this.findRole(roleId, true)
    return toPermissionViews(role._id.toString(), role.permissions)
  }

  /**
   * Thay toàn bộ quyền của role bằng danh sách mới (đã loại trùng action+subject).
   * Một `$set` nguyên tử trên mảng nhúng; quyền còn lại giữ `_id` và `createdAt`.
   */
  async setPermissions(
    roleId: string,
    permissions: PermissionInputDto[]
  ): Promise<RolePermissionView[]> {
    const role = await this.findRole(roleId, true)
    for (const p of permissions) {
      if (!(RBAC_ACTIONS as readonly string[]).includes(p.action)) {
        throw new BadRequestException(`Action "${p.action}" không hợp lệ`)
      }
      if (!(RBAC_SUBJECTS as readonly string[]).includes(p.subject)) {
        throw new BadRequestException(`Subject "${p.subject}" không hợp lệ`)
      }
    }
    const existing = new Map(
      (role.permissions ?? []).map(p => [permKey(p.action, p.subject), p])
    )
    const now = new Date()
    const next: RolePermission[] = [...uniqueByKey(permissions).entries()].map(
      ([key, p]) => {
        const prev = existing.get(key)
        return prev
          ? { ...prev, allowed: p.allowed, updatedAt: now }
          : {
              _id: new ObjectId(),
              action: p.action,
              subject: p.subject,
              allowed: p.allowed,
              createdAt: now,
              updatedAt: now,
            }
      }
    )

    const result = await this.roleRepository.updateOne(
      { _id: role._id },
      { $set: { permissions: next } }
    )
    if (!matched(result)) {
      throw new NotFoundException('Role không tồn tại')
    }
    return toPermissionViews(role._id.toString(), next)
  }

  // ───────────── helpers ─────────────

  /** Mặc định chiếu bỏ `permissions`; chỉ đọc quyền khi `withPermissions`. */
  private async findRole(id: string, withPermissions = false): Promise<Role> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Role không tồn tại')
    }
    const role = await this.roleRepository.findOne({
      where: { _id: new ObjectId(id) },
      ...(withPermissions
        ? {}
        : {
            select: [...ROLE_FIELDS_WITHOUT_PERMISSIONS] as (keyof Role)[],
          }),
    })
    if (!role) throw new NotFoundException('Role không tồn tại')
    return role
  }

  private async assertNameAvailable(name: string): Promise<void> {
    // Mongo: `countBy` nhận filter thô; `count({ where })` sẽ lọc theo trường `where` và trả 0.
    if ((await this.roleRepository.countBy({ name })) > 0) {
      throw new ConflictException(`Role "${name}" đã tồn tại`)
    }
  }
}
