import 'reflect-metadata'
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { BookingsController } from '../../bookings/controllers/bookings.controller'
import { CommunityController } from '../../community/controllers/community.controller'
import { SupportTicketsController } from '../../community/controllers/support-tickets.controller'
import { ContractAmendmentController } from '../../contracts/controllers/contract-amendment.controller'
import { ContractsController } from '../../contracts/controllers/contracts.controller'
import { DepositAgreementsController } from '../../contracts/controllers/deposit-agreements.controller'
import { ListingFreshnessController } from '../../admin/controllers/listing-freshness.controller'
import { PaymentsController } from '../../payments/controllers/payments.controller'
import { ApartmentsController } from '../../properties/controllers/apartments.controller'
import { DesignRequestsController } from '../../properties/controllers/design-requests.controller'
import { SafetyReportsController } from '../../properties/insights/controllers/safety-reports.controller'
import { KycController } from '../../users/controllers/kyc.controller'
import { OperationsController } from '../../admin/controllers/operations.controller'
import { FabricController } from '../../fabric/controllers/fabric.controller'
import { ViewingNotesController } from '../../bookings/controllers/viewing-notes.controller'
import { SavedSearchesController } from '../../properties/controllers/saved-searches.controller'
import { RentalApplicationsController } from '../../rental/controllers/rental-applications.controller'
import { PayoutsController } from '../../wallets/controllers/payouts.controller'
import { WalletController } from '../../wallets/controllers/wallet.controller'
import { PermissionsGuard } from './permissions.guard'
import {
  REQUIRE_PERMISSION_KEY,
  type PermissionAction,
  type PermissionSubject,
} from '../rbac.constants'

/**
 * Mọi route nhân viên dùng phải được gắn `@RequirePermission` đúng action/subject: nếu thiếu thì
 * công tắc của admin trong ma trận phân quyền không có tác dụng với route đó.
 * Cột: [phương thức HTTP, đường dẫn, action, subject].
 */
type Expect = [string, string, PermissionAction, PermissionSubject]
type Ctor = abstract new (...args: never[]) => unknown

const GET = 0
const POST = 1
const PUT = 2
const DELETE = 3
const PATCH = 4
const VERB: Record<number, string> = {
  [GET]: 'GET',
  [POST]: 'POST',
  [PUT]: 'PUT',
  [DELETE]: 'DELETE',
  [PATCH]: 'PATCH',
}

const TABLE: Array<[string, Ctor, Expect[]]> = [
  [
    'KycController',
    KycController,
    [
      ['GET', '/', 'read', 'Kyc'],
      ['GET', 'stats', 'read', 'Kyc'],
      ['GET', ':id', 'read', 'Kyc'],
      ['GET', ':id/media/:field', 'read', 'Kyc'],
      ['PATCH', ':id/review', 'approve', 'Kyc'],
    ],
  ],
  [
    'ApartmentsController',
    ApartmentsController,
    [
      ['GET', 'pending', 'read', 'Apartment'],
      ['GET', 'manage', 'read', 'Apartment'],
      ['GET', 'rejected', 'read', 'Apartment'],
      ['POST', '/', 'create', 'Apartment'],
      ['PATCH', ':id', 'update', 'Apartment'],
      ['PATCH', ':id/approve', 'approve', 'Apartment'],
      ['PATCH', ':id/reject', 'approve', 'Apartment'],
      ['PATCH', ':id/status', 'update', 'Apartment'],
      ['PATCH', ':id/media', 'update', 'Apartment'],
    ],
  ],
  [
    'ListingFreshnessController',
    ListingFreshnessController,
    [
      ['GET', 'queue', 'read', 'Apartment'],
      ['POST', ':id/detect', 'update', 'Apartment'],
      ['PATCH', 'cases/:id', 'update', 'Apartment'],
    ],
  ],
  ['BookingsController', BookingsController, [['GET', '/', 'read', 'Booking']]],
  [
    'CommunityController',
    CommunityController,
    [
      ['GET', 'posts/pending', 'read', 'CommunityPost'],
      ['PATCH', 'posts/:id/status', 'approve', 'CommunityPost'],
      ['DELETE', 'posts/:id', 'delete', 'CommunityPost'],
      ['DELETE', 'comments/:id', 'delete', 'CommunityPost'],
    ],
  ],
  [
    'SupportTicketsController',
    SupportTicketsController,
    [
      ['GET', 'queue', 'read', 'SupportTicket'],
      ['PATCH', ':id/assign', 'update', 'SupportTicket'],
      ['PATCH', ':id/escalate', 'update', 'SupportTicket'],
      ['PATCH', ':id/resolve', 'update', 'SupportTicket'],
    ],
  ],
  [
    'SafetyReportsController',
    SafetyReportsController,
    [
      ['GET', 'queue', 'read', 'SafetyReport'],
      ['GET', ':id', 'read', 'SafetyReport'],
      ['PATCH', ':id/status', 'update', 'SafetyReport'],
      ['PATCH', ':id/hide-target', 'update', 'SafetyReport'],
    ],
  ],
  [
    'DesignRequestsController',
    DesignRequestsController,
    [
      ['GET', 'queue', 'read', 'DesignRequest'],
      ['GET', ':id', 'read', 'DesignRequest'],
      ['POST', ':id/request-info', 'update', 'DesignRequest'],
      ['POST', ':id/reject', 'update', 'DesignRequest'],
      ['POST', ':id/start', 'update', 'DesignRequest'],
      ['POST', ':id/deliver', 'update', 'DesignRequest'],
    ],
  ],
  [
    'PaymentsController',
    PaymentsController,
    [
      ['GET', '/', 'read', 'Payment'],
      ['GET', 'overdue', 'read', 'Payment'],
      ['POST', 'overdue/process', 'update', 'Payment'],
      ['POST', ':id/confirm', 'update', 'Payment'],
    ],
  ],
  [
    'DepositAgreementsController',
    DepositAgreementsController,
    [
      ['POST', ':id/confirm-payment', 'update', 'Payment'],
      ['POST', ':id/expire', 'update', 'Payment'],
    ],
  ],
  [
    'ContractsController',
    ContractsController,
    [
      ['GET', '/', 'read', 'Contract'],
      ['GET', ':id', 'read', 'Contract'],
      ['GET', ':id/view', 'read', 'Contract'],
      ['POST', '/', 'create', 'Contract'],
      ['POST', ':id/deposit-agreement', 'create', 'Contract'],
      ['PUT', ':id/content', 'update', 'Contract'],
      ['POST', ':id/lock-content', 'update', 'Contract'],
      ['POST', ':id/artifacts/lock', 'update', 'Contract'],
      ['POST', ':id/artifacts/render-lock', 'update', 'Contract'],
      ['POST', ':id/terminate', 'update', 'Contract'],
    ],
  ],
  [
    'ContractAmendmentController',
    ContractAmendmentController,
    [
      ['POST', '/', 'create', 'Contract'],
      ['PUT', ':amendmentId', 'update', 'Contract'],
      ['POST', ':amendmentId/lock', 'update', 'Contract'],
      ['POST', ':amendmentId/artifact', 'update', 'Contract'],
      ['POST', ':amendmentId/cancel', 'update', 'Contract'],
    ],
  ],
]

/** Route của khách thuê và chủ nhà cũng phải theo ma trận (bổ sung cho bảng của nhân viên ở trên). */
const TABLE_EXTRA: Array<[string, Ctor, Expect[]]> = [
  [
    'BookingsController (tenant / landlord)',
    BookingsController,
    [
      ['POST', '/', 'create', 'Booking'],
      ['GET', 'my', 'read', 'Booking'],
      ['PATCH', ':id/cancel', 'update', 'Booking'],
      ['GET', 'landlord', 'read', 'Booking'],
      ['PATCH', ':id/status', 'approve', 'Booking'],
    ],
  ],
  [
    'ApartmentsController (landlord)',
    ApartmentsController,
    [
      ['GET', 'my-listings', 'read', 'Apartment'],
      ['GET', ':id/quality', 'read', 'Apartment'],
      ['PATCH', ':id/resubmit', 'update', 'Apartment'],
      ['PATCH', ':id/price', 'update', 'Apartment'],
      ['PATCH', ':id/renew', 'update', 'Apartment'],
      ['PATCH', ':id/packages', 'update', 'Apartment'],
    ],
  ],
  [
    'RentalApplicationsController',
    RentalApplicationsController,
    [
      ['POST', '/', 'create', 'RentalApplication'],
      ['GET', 'mine', 'read', 'RentalApplication'],
      ['GET', 'received', 'read', 'RentalApplication'],
      ['PATCH', ':id/respond', 'approve', 'RentalApplication'],
    ],
  ],
  [
    'ContractsController (signing)',
    ContractsController,
    [
      ['PUT', ':id/sign', 'approve', 'Contract'],
      ['POST', ':id/smartca/sign-v2', 'approve', 'Contract'],
    ],
  ],
  [
    'CommunityController (posting)',
    CommunityController,
    [
      ['POST', 'posts', 'create', 'CommunityPost'],
      ['POST', 'posts/:id/comments', 'create', 'CommunityPost'],
    ],
  ],
  [
    'SupportTicketsController (requesters)',
    SupportTicketsController,
    [
      ['POST', '/', 'create', 'SupportTicket'],
      ['GET', 'my', 'read', 'SupportTicket'],
      ['POST', ':id/messages', 'create', 'SupportTicket'],
      ['PATCH', ':id/close', 'update', 'SupportTicket'],
    ],
  ],
  [
    'SafetyReportsController (reporters)',
    SafetyReportsController,
    [
      ['POST', '/', 'create', 'SafetyReport'],
      ['POST', ':id/appeal', 'update', 'SafetyReport'],
    ],
  ],
  [
    'DesignRequestsController (landlord)',
    DesignRequestsController,
    [
      ['POST', '/', 'create', 'DesignRequest'],
      ['GET', 'my', 'read', 'DesignRequest'],
      ['POST', ':id/reply', 'update', 'DesignRequest'],
      ['POST', ':id/approve', 'approve', 'DesignRequest'],
      ['POST', ':id/feedback', 'update', 'DesignRequest'],
      ['POST', ':id/cancel', 'update', 'DesignRequest'],
    ],
  ],
  [
    'WalletController',
    WalletController,
    [
      ['GET', '/', 'read', 'Wallet'],
      ['POST', 'link', 'create', 'Wallet'],
      ['GET', 'transactions', 'read', 'Wallet'],
      ['GET', 'invoices', 'read', 'Wallet'],
      ['GET', 'receiving-status', 'read', 'Wallet'],
    ],
  ],
  [
    'OperationsController',
    OperationsController,
    [
      ['GET', 'stats', 'read', 'Report'],
      ['GET', 'chart-data', 'read', 'Report'],
    ],
  ],
  [
    'FabricController (audit center)',
    FabricController,
    [
      ['GET', 'status', 'read', 'AuditLog'],
      ['POST', 'outbox/:id/retry', 'update', 'AuditLog'],
      ['POST', 'query', 'update', 'AuditLog'],
      ['GET', 'logs', 'read', 'AuditLog'],
      ['GET', 'governance-snapshots', 'read', 'AuditLog'],
      ['GET', 'governance-snapshots/:id', 'read', 'AuditLog'],
      ['GET', 'governance-snapshots/:id/verify', 'read', 'AuditLog'],
      ['GET', 'audit/overview', 'read', 'AuditLog'],
      ['GET', 'audit/events', 'read', 'AuditLog'],
      ['GET', 'audit/events/:id', 'read', 'AuditLog'],
      ['GET', 'reconciliation-runs', 'read', 'AuditLog'],
      ['GET', 'reconciliation-runs/:id', 'read', 'AuditLog'],
      ['GET', 'reconciliation-runs/:id/findings', 'read', 'AuditLog'],
    ],
  ],
  [
    'ViewingNotesController',
    ViewingNotesController,
    [
      ['POST', '/', 'create', 'ViewingNote'],
      ['GET', '/', 'read', 'ViewingNote'],
      ['GET', ':id', 'read', 'ViewingNote'],
      ['PATCH', ':id', 'update', 'ViewingNote'],
      ['DELETE', ':id', 'delete', 'ViewingNote'],
    ],
  ],
  [
    'SavedSearchesController',
    SavedSearchesController,
    [
      ['POST', '/', 'create', 'SavedSearch'],
      ['GET', '/', 'read', 'SavedSearch'],
      ['PATCH', ':id', 'update', 'SavedSearch'],
      ['DELETE', ':id', 'delete', 'SavedSearch'],
      ['PATCH', ':id/toggle-alert', 'update', 'SavedSearch'],
      ['GET', 'alerts', 'read', 'SavedSearch'],
      ['PATCH', 'alerts/:id/read', 'update', 'SavedSearch'],
      ['PATCH', 'alerts/read-all', 'update', 'SavedSearch'],
    ],
  ],
  [
    'PayoutsController',
    PayoutsController,
    [
      ['GET', 'me', 'read', 'Payout'],
      ['GET', ':id', 'read', 'Payout'],
      ['POST', ':id/report-issue', 'update', 'Payout'],
    ],
  ],
]

interface Found {
  verb: string
  path: string
  required: { action: string; subject: string } | undefined
  guards: unknown[]
}

/** Chỉ so action và subject (metadata còn có audience dành cho bảng phân quyền). */
function pick(value: unknown): { action: string; subject: string } | undefined {
  const v = value as { action: string; subject: string } | undefined
  return v ? { action: v.action, subject: v.subject } : undefined
}

function routesOf(controller: Ctor): Found[] {
  const proto = controller.prototype as Record<string, unknown>
  const classGuards =
    (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? []
  return Object.getOwnPropertyNames(proto)
    .filter(
      name =>
        name !== 'constructor' &&
        typeof proto[name] === 'function' &&
        Reflect.getMetadata(METHOD_METADATA, proto[name] as object) !==
          undefined
    )
    .map(name => {
      const fn = proto[name] as object
      const method = Reflect.getMetadata(METHOD_METADATA, fn) as number
      const rawPath = Reflect.getMetadata(PATH_METADATA, fn) as string
      return {
        verb: VERB[method] ?? String(method),
        path: !rawPath || rawPath === '/' ? '/' : rawPath,
        required: pick(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, fn)),
        guards: [
          ...classGuards,
          ...((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []),
        ],
      }
    })
}

describe('routes honour the admin permission matrix', () => {
  it.each([...TABLE, ...TABLE_EXTRA])('%s', (_name, controller, expected) => {
    const routes = routesOf(controller)
    for (const [verb, path, action, subject] of expected) {
      const route = routes.find(r => r.verb === verb && r.path === path)
      expect({ verb, path, found: route !== undefined }).toEqual({
        verb,
        path,
        found: true,
      })
      expect({ verb, path, required: route?.required }).toEqual({
        verb,
        path,
        required: { action, subject },
      })
      expect({
        verb,
        path,
        guarded: route?.guards.includes(PermissionsGuard),
      }).toEqual({ verb, path, guarded: true })
    }
  })
})
