/** Hành động hợp lệ của permission. */
export const RBAC_ACTIONS = [
  'manage',
  'create',
  'read',
  'update',
  'delete',
  'approve',
] as const

/** Đối tượng nghiệp vụ hợp lệ của permission ('all' = mọi đối tượng). */
export const RBAC_SUBJECTS = [
  'all',
  'User',
  'Kyc',
  'Project',
  'Building',
  'Apartment',
  'Booking',
  'RentalApplication',
  'RentalTransaction',
  'Contract',
  'Payment',
  'Wallet',
  'Payout',
  'Dispute',
  'SupportTicket',
  'Notification',
  'LegalSource',
  'Role',
  'Job',
] as const

export type RbacAction = (typeof RBAC_ACTIONS)[number]
export type RbacSubject = (typeof RBAC_SUBJECTS)[number]

export interface DefaultPermission {
  action: RbacAction
  subject: RbacSubject
  allowed: boolean
}

export interface DefaultRole {
  name: string
  description: string
  permissions: DefaultPermission[]
}

const can = (
  action: RbacAction,
  ...subjects: RbacSubject[]
): DefaultPermission[] =>
  subjects.map(subject => ({ action, subject, allowed: true }))

/**
 * Role mặc định, khớp 4 role mà `RolesGuard`/`@Roles(...)` đang dùng
 * (enum `role` của User: tenant | landlord | staff | admin).
 * Chỉ là dữ liệu quản trị: RolesGuard vẫn đọc role từ JWT, không đọc bảng này.
 */
export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: 'admin',
    description: 'Quản trị viên — toàn quyền hệ thống',
    permissions: can('manage', 'all'),
  },
  {
    name: 'staff',
    description: 'Nhân viên vận hành — duyệt KYC, tin đăng, hỗ trợ, tranh chấp',
    permissions: [
      ...can('read', 'User', 'Booking', 'Contract', 'Payment'),
      ...can('approve', 'Kyc', 'Apartment', 'Dispute'),
      ...can('manage', 'SupportTicket'),
      ...can('read', 'Kyc', 'Apartment', 'Dispute'),
    ],
  },
  {
    name: 'landlord',
    description: 'Chủ nhà — quản lý tin đăng, hợp đồng và thu nhập của mình',
    permissions: [
      ...can('manage', 'Apartment', 'Building', 'Project'),
      ...can('read', 'Booking', 'RentalApplication', 'RentalTransaction'),
      ...can('manage', 'Contract', 'Payout', 'Wallet'),
    ],
  },
  {
    name: 'tenant',
    description: 'Người thuê — đặt lịch, thuê nhà, thanh toán',
    permissions: [
      ...can('read', 'Apartment', 'Building', 'Project'),
      ...can('manage', 'Booking', 'RentalApplication'),
      ...can('read', 'Contract'),
      ...can('create', 'Payment', 'Dispute', 'SupportTicket'),
    ],
  },
]
