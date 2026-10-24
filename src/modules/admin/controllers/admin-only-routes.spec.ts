import 'reflect-metadata'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { ContractLayoutsController } from '../../contracts/layout/contract-layouts.controller'
import { OwnershipTransferController } from '../../contracts/controllers/ownership-transfer.controller'
import { LegalKnowledgeController } from '../../legal/controllers/legal-knowledge.controller'
import { AdminPaymentsController } from '../../payments/controllers/admin-payments.controller'
import { PlatformFeesController } from '../../payments/controllers/platform-fees.controller'
import { RecommendationsController } from '../../properties/recommendations/controllers/recommendations.controller'
import { RentalExecutionPoliciesController } from '../../rental/controllers/rental-execution-policies.controller'
import { RentalTransactionsController } from '../../rental/controllers/rental-transactions.controller'
import { UsersController } from '../../users/controllers/users.controller'
import { AdminWalletsController } from '../../wallets/controllers/admin-wallets.controller'
import { GroqKeysController } from '../controllers/groq-keys.controller'
import { NavConfigController } from '../controllers/nav-config.controller'
import { PlatformRegulationsController } from '../controllers/platform-regulations.controller'
import { RentalFlowAssignmentsController } from '../controllers/rental-flow-assignments.controller'
import { RentalFlowProfilesController } from '../controllers/rental-flow-profiles.controller'

/**
 * Các API phục vụ riêng mục "Quản trị hệ thống" của bảng điều khiển phải chỉ dành cho admin, kể cả
 * khi chỉ là đọc. `RolesGuard` không phải guard toàn cục nên mỗi route phải vừa có `@Roles('admin')`
 * vừa được gắn `RolesGuard`, nếu thiếu guard thì `@Roles` bị bỏ qua.
 */

type Ctor = abstract new (...args: never[]) => unknown

interface Route {
  name: string
  path: string
  roles: string[] | undefined
  guards: unknown[]
}

function routesOf(controller: Ctor): Route[] {
  const proto = controller.prototype as Record<string, unknown>
  const classGuards =
    (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? []
  const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as
    | string[]
    | undefined
  return Object.getOwnPropertyNames(proto)
    .filter(name => {
      const fn = proto[name]
      return (
        name !== 'constructor' &&
        typeof fn === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, fn) !== undefined
      )
    })
    .map(name => {
      const fn = proto[name] as object
      const methodGuards =
        (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
      return {
        name,
        path: String(Reflect.getMetadata(PATH_METADATA, fn) ?? ''),
        roles:
          (Reflect.getMetadata(ROLES_KEY, fn) as string[] | undefined) ??
          classRoles,
        guards: [...classGuards, ...methodGuards],
      }
    })
}

function expectAdminOnly(route: Route, label: string): void {
  expect({ label, roles: route.roles }).toEqual({ label, roles: ['admin'] })
  expect({ label, rolesGuard: route.guards.includes(RolesGuard) }).toEqual({
    label,
    rolesGuard: true,
  })
  expect({ label, jwt: route.guards.includes(JwtAuthGuard) }).toEqual({
    label,
    jwt: true,
  })
}

describe('admin-only API surface rejects staff', () => {
  const wholeController: Array<[string, Ctor]> = [
    ['AdminWalletsController', AdminWalletsController],
    ['AdminPaymentsController', AdminPaymentsController],
    ['RentalFlowProfilesController', RentalFlowProfilesController],
    ['RentalFlowAssignmentsController', RentalFlowAssignmentsController],
    ['OwnershipTransferController', OwnershipTransferController],
    ['GroqKeysController', GroqKeysController],
    ['LegalKnowledgeController', LegalKnowledgeController],
    ['PlatformRegulationsController', PlatformRegulationsController],
  ]

  it.each(wholeController)('every route of %s is admin only', (name, ctor) => {
    const routes = routesOf(ctor)
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) expectAdminOnly(route, `${name}.${route.name}`)
  })

  // Controller trộn route công khai / theo vai trò: chỉ các route khớp bộ lọc mới phải là admin.
  const mixed: Array<[string, Ctor, (route: Route) => boolean]> = [
    [
      'PlatformFeesController',
      PlatformFeesController,
      (r: Route): boolean =>
        r.path.startsWith('admin/') || r.path === 'revenue',
    ],
    [
      'RentalTransactionsController',
      RentalTransactionsController,
      (r: Route): boolean =>
        r.path === 'admin/stuck' || r.path.endsWith('/recover'),
    ],
    [
      'RentalExecutionPoliciesController',
      RentalExecutionPoliciesController,
      (r: Route): boolean => r.path.startsWith('admin'),
    ],
    [
      'ContractLayoutsController',
      ContractLayoutsController,
      (r: Route): boolean => r.path.startsWith('admin/'),
    ],
    [
      'RecommendationsController',
      RecommendationsController,
      (r: Route): boolean => r.path === 'engine-config' || r.path === 'sync',
    ],
    [
      'UsersController',
      UsersController,
      (r: Route): boolean =>
        r.path.includes('permissions') ||
        r.path.endsWith('/role') ||
        r.path === '',
    ],
  ]

  it.each(mixed)(
    'the admin routes of %s are admin only',
    (name, ctor, pick) => {
      const routes = routesOf(ctor).filter(pick)
      expect(routes.length).toBeGreaterThan(0)
      for (const route of routes)
        expectAdminOnly(route, `${name}.${route.name}`)
    }
  )

  it('NavConfigController: staff may only read, never write', () => {
    const routes = routesOf(NavConfigController)
    const get = routes.find(r => r.name === 'get')
    const update = routes.find(r => r.name === 'update')
    expect(get?.roles).toEqual(['staff', 'admin'])
    expect(get?.guards).toContain(RolesGuard)
    expectAdminOnly(update as Route, 'NavConfigController.update')
  })
})
