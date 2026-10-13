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
import { Repository } from 'typeorm'
import type {
  CreateRoleDto,
  PermissionInputDto,
  UpdateRoleDto,
} from '../dto/rbac.dto'
import {
  DEFAULT_ROLES,
  RBAC_ACTIONS,
  RBAC_SUBJECTS,
  type DefaultRole,
} from '../rbac.constants'
import { Permission } from '../schemas/permission.schema'
import { Role } from '../schemas/role.schema'

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name)

  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>
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
   * Idempotent: chỉ tạo role còn thiếu (theo name) cùng quyền mặc định của nó.
   * Role đã tồn tại (kể cả đã bị admin chỉnh quyền) không bị ghi đè.
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

      const role = await this.roleRepository.save(
        this.roleRepository.create({
          name: def.name,
          description: def.description,
          isActive: true,
          isSystem: true,
        })
      )
      await this.permissionRepository.save(
        def.permissions.map(p =>
          this.permissionRepository.create({
            ...p,
            roleId: role._id.toString(),
          })
        )
      )
      created.push(def.name)
    }
    return created
  }

  getMetadata(): { actions: readonly string[]; subjects: readonly string[] } {
    return { actions: RBAC_ACTIONS, subjects: RBAC_SUBJECTS }
  }

  // ───────────── Role ─────────────

  listRoles(): Promise<Role[]> {
    return this.roleRepository.find({ order: { name: 'ASC' } })
  }

  getRole(id: string): Promise<Role> {
    return this.findRole(id)
  }

  async createRole(dto: CreateRoleDto): Promise<Role> {
    await this.assertNameAvailable(dto.name)
    return this.roleRepository.save(
      this.roleRepository.create({
        name: dto.name,
        description: dto.description ?? '',
        isActive: true,
        isSystem: false,
      })
    )
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.findRole(id)
    if (dto.name !== undefined && dto.name !== role.name) {
      if (role.isSystem) {
        throw new BadRequestException('Không thể đổi tên role mặc định')
      }
      await this.assertNameAvailable(dto.name)
      role.name = dto.name
    }
    if (dto.description !== undefined) role.description = dto.description
    if (dto.isActive !== undefined) role.isActive = dto.isActive
    return this.roleRepository.save(role)
  }

  async deleteRole(id: string): Promise<{ deleted: true }> {
    const role = await this.findRole(id)
    if (role.isSystem) {
      throw new BadRequestException('Không thể xóa role mặc định')
    }
    await this.permissionRepository.delete({ roleId: role._id.toString() })
    await this.roleRepository.delete(role._id)
    return { deleted: true }
  }

  // ───────────── Permission ─────────────

  async getPermissions(roleId: string): Promise<Permission[]> {
    const role = await this.findRole(roleId)
    return this.permissionRepository.find({
      where: { roleId: role._id.toString() },
    })
  }

  /** Thay toàn bộ quyền của role bằng danh sách mới (đã loại trùng action+subject). */
  async setPermissions(
    roleId: string,
    permissions: PermissionInputDto[]
  ): Promise<Permission[]> {
    const role = await this.findRole(roleId)
    for (const p of permissions) {
      if (!(RBAC_ACTIONS as readonly string[]).includes(p.action)) {
        throw new BadRequestException(`Action "${p.action}" không hợp lệ`)
      }
      if (!(RBAC_SUBJECTS as readonly string[]).includes(p.subject)) {
        throw new BadRequestException(`Subject "${p.subject}" không hợp lệ`)
      }
    }
    const unique = new Map<string, PermissionInputDto>()
    for (const p of permissions) unique.set(`${p.action}:${p.subject}`, p)

    const id = role._id.toString()
    await this.permissionRepository.delete({ roleId: id })
    if (unique.size > 0) {
      await this.permissionRepository.save(
        [...unique.values()].map(p =>
          this.permissionRepository.create({
            action: p.action,
            subject: p.subject,
            allowed: p.allowed,
            roleId: id,
          })
        )
      )
    }
    return this.permissionRepository.find({ where: { roleId: id } })
  }

  // ───────────── helpers ─────────────

  private async findRole(id: string): Promise<Role> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Role không tồn tại')
    }
    const role = await this.roleRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!role) throw new NotFoundException('Role không tồn tại')
    return role
  }

  private async assertNameAvailable(name: string): Promise<void> {
    if ((await this.roleRepository.count({ where: { name } })) > 0) {
      throw new ConflictException(`Role "${name}" đã tồn tại`)
    }
  }
}
