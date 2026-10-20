import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from '../rbac.constants'
import { RbacService } from '../services/rbac.service'

const ACTION_LABELS: Record<string, string> = {
  create: 'tạo',
  read: 'xem',
  update: 'sửa',
  delete: 'xóa',
  approve: 'duyệt',
}

const SUBJECT_LABELS: Record<string, string> = {
  Kyc: 'xác minh KYC',
  Apartment: 'căn hộ',
  Booking: 'lịch hẹn',
  CommunityPost: 'bài cộng đồng',
  SupportTicket: 'hỗ trợ',
  SafetyReport: 'báo cáo an toàn',
  DesignRequest: 'yêu cầu thiết kế 3D',
  Payment: 'thanh toán',
  Contract: 'hợp đồng',
  RentalApplication: 'hồ sơ thuê',
  Wallet: 'ví nhận tiền',
  Payout: 'khoản chi trả',
}

/**
 * Chặn khách thuê, chủ nhà và nhân viên khi admin đã tắt quyền tương ứng của vai trò đó (xem
 * `isAllowed`). Chỉ áp cho route có `@RequirePermission`. Admin luôn đi qua.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      RequiredPermission | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()])
    if (!required) return true

    const user = context
      .switchToHttp()
      .getRequest<{ user?: UserPayload }>().user
    // Route công khai (vd. khách đặt lịch không đăng nhập) không có người dùng để áp vai trò.
    if (!user) return true

    const roles = (user.roles ?? []).map(r => r.toLowerCase())
    if (roles.includes('admin')) return true

    if (
      await this.rbac.roleCan(
        roles,
        required.action,
        required.subject,
        user._id
      )
    ) {
      return true
    }

    const action = ACTION_LABELS[required.action] ?? required.action
    const subject = SUBJECT_LABELS[required.subject] ?? required.subject
    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: `Bạn chưa được cấp quyền ${action} ${subject}. Vui lòng liên hệ quản trị viên.`,
    })
  }
}
