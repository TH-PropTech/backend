import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId, type UpdateResult } from 'mongodb'
import { MongoRepository } from 'typeorm'
import { User } from '../../users/schemas/user.schema'
import {
  CUSTOM_ROLE_NAME_PATTERN,
  RESERVED_ROLE_NAMES,
  type CreateRoleDto,
  type PermissionInputDto,
  type UpdateRoleDto,
} from '../dto/rbac.dto'
import { isAllowed, type PolicyEntry } from '../permission-policy'
import {
  DEFAULT_ROLES,
  RBAC_ACTIONS,
  RBAC_SUBJECTS,
  type DefaultPermission,
  MANAGED_ROLES,
  type DefaultRole,
  type ManagedRole,
  type PermissionAction,
  type PermissionSubject,
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

/** Thời gian giữ bản chính sách các vai trò trong bộ nhớ (mỗi instance), để guard không đọc DB mỗi request. */
const POLICY_TTL_MS = 10_000

const managedRolesOf = (roleNames: readonly string[]): ManagedRole[] =>
  MANAGED_ROLES.filter(role =>
    roleNames.some(name => name.toLowerCase() === role)
  )

const PERMISSION_ACTIONS: readonly PermissionAction[] = [
  'create',
  'read',
  'update',
  'delete',
  'approve',
]

/** Ảnh chụp chính sách trong bộ nhớ: quyền theo tên role và vai trò gốc của vai trò tùy chỉnh đang bật. */
interface PolicySnapshot {
  at: number
  byRole: Map<string, PolicyEntry[]>
  customBase: Map<string, ManagedRole>
}

function matched(result: unknown): boolean {
  return ((result as { matchedCount?: number } | null)?.matchedCount ?? 0) > 0
}

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name)
  private policies: PolicySnapshot | null = null
  private readonly profiles = new Map<
    string,
    { profile: string | null; at: number }
  >()

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: MongoRepository<Role>,
    @InjectRepository(User)
    private readonly userRepository: MongoRepository<User>
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
    if (dto.baseRole) return this.createCustomRole(dto, dto.baseRole)
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
    const set: Partial<
      Pick<Role, 'name' | 'description' | 'isActive' | 'label'>
    > = {}
    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem) {
        throw new BadRequestException('Không thể đổi tên role mặc định')
      }
      if (role.baseRole) {
        // Mã vai trò tùy chỉnh được lưu trên từng người dùng (permissionProfile), nên cố định.
        throw new BadRequestException('Không thể đổi mã vai trò tùy chỉnh')
      }
      await this.assertNameAvailable(dto.name)
      role.name = dto.name
      set.name = dto.name
    }
    if (dto.description !== undefined) {
      role.description = dto.description
      set.description = dto.description
    }
    if (dto.label !== undefined) {
      role.label = dto.label
      set.label = dto.label
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
    this.invalidate()
    return toRoleView(role)
  }

  async deleteRole(id: string): Promise<{ deleted: true }> {
    const role = await this.findRole(id)
    if (role.isSystem) {
      throw new BadRequestException('Không thể xóa role mặc định')
    }
    await this.roleRepository.delete(role._id)
    if (role.baseRole) {
      // Người dùng đang gán vai trò này trở về quyền của vai trò gốc.
      await this.userRepository.updateMany(
        { permissionProfile: role.name },
        { $set: { permissionProfile: null } }
      )
    }
    this.invalidate()
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
    this.invalidate()
    if (!matched(result)) {
      throw new NotFoundException('Role không tồn tại')
    }
    return toPermissionViews(role._id.toString(), next)
  }

  // ───────────── Hiệu lực quyền theo vai trò ─────────────

  /**
   * Người dùng có các vai trò `roleNames` có được `action` trên `subject` không.
   *
   * - Người dùng được gán vai trò tùy chỉnh (`userId` có `permissionProfile`) thì dùng bảng quyền
   *   của vai trò đó, miễn là vai trò gốc của nó khớp với một vai trò của người dùng.
   * - Ngược lại: được nếu BẤT KỲ vai trò quản lý được (khách thuê, chủ nhà, nhân viên) của họ cho phép.
   * - Không có vai trò nào trong số đó thì không bị ma trận chi phối.
   *
   * Admin do `PermissionsGuard` cho qua trước.
   */
  async roleCan(
    roleNames: readonly string[],
    action: PermissionAction,
    subject: PermissionSubject,
    userId?: string
  ): Promise<boolean> {
    const managed = managedRolesOf(roleNames)
    if (managed.length === 0) return true
    const { byRole, customBase } = await this.loadPolicies()
    const profile = userId ? await this.profileOf(userId) : null
    const base = profile ? customBase.get(profile) : undefined
    if (profile && base && managed.includes(base)) {
      return isAllowed(byRole.get(profile) ?? [], action, subject)
    }
    return managed.some(role =>
      isAllowed(byRole.get(role) ?? [], action, subject)
    )
  }

  /**
   * Bảng quyền hiệu lực của người gọi dạng `'read:Kyc': true`, cho giao diện ẩn nút. Admin luôn đủ
   * quyền. Đây chỉ để hiển thị: việc chặn thật nằm ở `PermissionsGuard`.
   */
  async effectivePermissions(
    roleNames: readonly string[],
    isAdmin: boolean,
    userId?: string
  ): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {}
    for (const subject of RBAC_SUBJECTS) {
      if (subject === 'all') continue
      for (const action of PERMISSION_ACTIONS) {
        out[`${action}:${subject}`] =
          isAdmin || (await this.roleCan(roleNames, action, subject, userId))
      }
    }
    return out
  }

  // ───────────── Vai trò tùy chỉnh ─────────────

  /**
   * Tạo vai trò tùy chỉnh dựa trên `baseRole`: sao chép quyền hiện tại của vai trò gốc làm điểm
   * xuất phát, sau đó chỉnh độc lập.
   */
  private async createCustomRole(
    dto: CreateRoleDto,
    baseRole: ManagedRole
  ): Promise<RoleView> {
    if (
      !CUSTOM_ROLE_NAME_PATTERN.test(dto.name) ||
      (RESERVED_ROLE_NAMES as readonly string[]).includes(dto.name)
    ) {
      throw new BadRequestException(
        'Mã vai trò gồm 3 đến 40 ký tự: chữ thường, số, gạch ngang hoặc gạch dưới, bắt đầu bằng chữ, và không trùng mã hệ thống'
      )
    }
    await this.assertNameAvailable(dto.name)
    const base = await this.roleRepository.findOne({
      where: { name: baseRole },
    })
    const now = new Date()
    const saved = await this.roleRepository.save(
      this.roleRepository.create({
        name: dto.name,
        label: dto.label ?? dto.name,
        description: dto.description ?? '',
        isActive: true,
        isSystem: false,
        baseRole,
        permissions: (base?.permissions ?? []).map(p => ({
          _id: new ObjectId(),
          action: p.action,
          subject: p.subject,
          allowed: p.allowed,
          createdAt: now,
          updatedAt: now,
        })),
      })
    )
    this.invalidate()
    return toRoleView(saved)
  }

  /**
   * Đặt đúng danh sách người dùng của một vai trò tùy chỉnh: người trong danh sách được gán, người
   * đang gán mà không còn trong danh sách trở về quyền của vai trò gốc. Mỗi người chỉ có một vai
   * trò tùy chỉnh (gán sang vai trò này thì thay vai trò cũ) và phải có đúng vai trò gốc.
   */
  async setRoleUsers(
    roleId: string,
    userIds: readonly string[]
  ): Promise<{ assigned: number; removed: number }> {
    const role = await this.findRole(roleId)
    if (!role.baseRole) {
      throw new BadRequestException('Chỉ gán người dùng cho vai trò tùy chỉnh')
    }
    if (!role.isActive) {
      throw new BadRequestException(
        'Vai trò đang tắt, hãy bật lại trước khi gán'
      )
    }
    const ids = [...new Set(userIds)]
    if (ids.some(id => !ObjectId.isValid(id))) {
      throw new BadRequestException('Mã người dùng không hợp lệ')
    }
    const objectIds = ids.map(id => new ObjectId(id))
    if (objectIds.length > 0) {
      const eligible = await this.userRepository.countBy({
        _id: { $in: objectIds },
        role: role.baseRole,
      })
      if (eligible !== objectIds.length) {
        throw new BadRequestException(
          `Chỉ gán được người dùng có vai trò gốc "${role.baseRole}"`
        )
      }
    }
    const removed = (await this.userRepository.updateMany(
      { permissionProfile: role.name, _id: { $nin: objectIds } },
      { $set: { permissionProfile: null } }
    )) as UpdateResult
    const assigned =
      objectIds.length > 0
        ? ((await this.userRepository.updateMany(
            { _id: { $in: objectIds } },
            { $set: { permissionProfile: role.name } }
          )) as UpdateResult)
        : null
    this.profiles.clear()
    return {
      assigned: assigned?.modifiedCount ?? 0,
      removed: removed.modifiedCount ?? 0,
    }
  }

  /** Vai trò tùy chỉnh đang gán cho người dùng (null nếu không có). */
  private async profileOf(userId: string): Promise<string | null> {
    const cached = this.profiles.get(userId)
    if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.profile
    if (!ObjectId.isValid(userId)) return null
    try {
      const rows = (await this.userRepository
        .aggregate([
          { $match: { _id: new ObjectId(userId) } },
          { $project: { permissionProfile: 1 } },
        ])
        .toArray()) as Array<{ permissionProfile?: string | null }>
      const profile = rows[0]?.permissionProfile ?? null
      this.profiles.set(userId, { profile, at: Date.now() })
      return profile
    } catch (error) {
      this.logger.warn(
        `Failed to load permission profile: ${error instanceof Error ? error.message : 'unknown'}`
      )
      return cached?.profile ?? null
    }
  }

  /** Bỏ bản chính sách trong bộ nhớ để lần kiểm tra sau đọc lại DB. */
  private invalidate(): void {
    this.policies = null
    this.profiles.clear()
  }

  /** Lỗi đọc DB thì dùng bản cũ (nếu có), nếu không thì không có mục nào tức cho phép như mặc định. */
  private async loadPolicies(): Promise<PolicySnapshot> {
    const cached = this.policies
    if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached
    try {
      const roles = await this.roleRepository.find()
      const byRole = new Map<string, PolicyEntry[]>()
      const customBase = new Map<string, ManagedRole>()
      for (const role of roles) {
        const custom =
          role.baseRole && role.isActive !== false
            ? MANAGED_ROLES.find(r => r === role.baseRole)
            : undefined
        const isManaged = (MANAGED_ROLES as readonly string[]).includes(
          role.name
        )
        if (!isManaged && !custom) continue
        byRole.set(
          role.name,
          (role.permissions ?? []).map(p => ({
            action: p.action,
            subject: p.subject,
            allowed: p.allowed,
          }))
        )
        if (custom) customBase.set(role.name, custom)
      }
      const snapshot: PolicySnapshot = { at: Date.now(), byRole, customBase }
      this.policies = snapshot
      return snapshot
    } catch (error) {
      this.logger.warn(
        `Failed to load role permissions: ${error instanceof Error ? error.message : 'unknown'}`
      )
      return cached ?? { at: 0, byRole: new Map(), customBase: new Map() }
    }
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
