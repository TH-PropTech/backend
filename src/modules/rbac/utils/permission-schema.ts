import 'reflect-metadata'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import {
  MANAGED_ROLES,
  RBAC_SUBJECTS,
  REQUIRE_PERMISSION_KEY,
  type ManagedRole,
  type PermissionAction,
  type PermissionSubject,
  type RequiredPermission,
} from '../rbac.constants'

export interface PermissionSchemaRow {
  subject: PermissionSubject
  /** Các thao tác của vai trò này trên đối tượng đó mà backend thật sự kiểm tra. */
  actions: PermissionAction[]
}

export type PermissionSchema = Record<ManagedRole, PermissionSchemaRow[]>

const ACTION_ORDER: readonly PermissionAction[] = [
  'read',
  'create',
  'update',
  'delete',
  'approve',
]

const isManaged = (role: string): role is ManagedRole =>
  (MANAGED_ROLES as readonly string[]).includes(role)

type Ctor = abstract new (...args: never[]) => unknown

/**
 * Dựng bảng "vai trò nào được bật/tắt thao tác nào trên đối tượng nào" trực tiếp từ các route đã gắn
 * `@RequirePermission`, nên giao diện phân quyền luôn đúng với những gì backend thật sự chặn.
 *
 * Vai trò của một route lấy theo thứ tự: `@Roles` của route, `@Roles` của controller, `audience`
 * khai báo trong `@RequirePermission`, cuối cùng là mọi vai trò quản lý được.
 */
export function buildPermissionSchema(
  controllers: readonly Ctor[]
): PermissionSchema {
  const found = new Map<
    ManagedRole,
    Map<PermissionSubject, Set<PermissionAction>>
  >(MANAGED_ROLES.map(role => [role, new Map()]))

  for (const controller of controllers) {
    const proto = controller.prototype as Record<string, unknown>
    const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as
      | string[]
      | undefined
    const classRequired = Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      controller
    ) as RequiredPermission | undefined

    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name]
      if (name === 'constructor' || typeof handler !== 'function') continue
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue

      const required =
        (Reflect.getMetadata(REQUIRE_PERMISSION_KEY, handler) as
          | RequiredPermission
          | undefined) ?? classRequired
      if (!required) continue

      const declared =
        (Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined) ??
        classRoles ??
        required.audience
      const roles = declared
        ? declared.map(r => r.toLowerCase()).filter(isManaged)
        : [...MANAGED_ROLES]

      for (const role of roles) {
        const bySubject = found.get(role)
        if (!bySubject) continue
        const actions = bySubject.get(required.subject) ?? new Set()
        actions.add(required.action)
        bySubject.set(required.subject, actions)
      }
    }
  }

  const subjectOrder = new Map<string, number>(
    RBAC_SUBJECTS.map((subject, index) => [subject, index])
  )
  const schema = {} as PermissionSchema
  for (const role of MANAGED_ROLES) {
    const bySubject =
      found.get(role) ?? new Map<PermissionSubject, Set<PermissionAction>>()
    schema[role] = [...bySubject.entries()]
      .sort(
        ([a], [b]) => (subjectOrder.get(a) ?? 0) - (subjectOrder.get(b) ?? 0)
      )
      .map(([subject, actions]) => ({
        subject,
        actions: ACTION_ORDER.filter(action => actions.has(action)),
      }))
  }
  return schema
}
