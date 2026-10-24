import type { PermissionAction, PermissionSubject } from '../rbac.constants'

export interface PolicyEntry {
  action: string
  subject: string
  allowed: boolean
}

/**
 * Quyết định một nhân viên có được làm `action` trên `subject` không.
 *
 * Thứ tự ưu tiên: khớp đúng (action, subject) > `manage` của subject > action trên `all` > `manage`
 * trên `all`. Không có mục nào khớp thì **cho phép**: đây là hành vi sẵn có trước khi có ma trận
 * phân quyền, nên chỉ khi admin chủ động tắt (mục `allowed: false`) thì nhân viên mới bị chặn.
 */
export function isAllowed(
  entries: readonly PolicyEntry[],
  action: PermissionAction,
  subject: PermissionSubject
): boolean {
  const find = (a: string, s: string): PolicyEntry | undefined =>
    entries.find(e => e.action === a && e.subject === s)
  const hit =
    find(action, subject) ??
    find('manage', subject) ??
    find(action, 'all') ??
    find('manage', 'all')
  return hit ? hit.allowed : true
}
