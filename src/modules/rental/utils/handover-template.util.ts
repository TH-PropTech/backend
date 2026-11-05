import { createHash } from 'crypto'

/** Khóa duy nhất của mẫu biên bản bàn giao khi vào ở (kind 'handover-template'). */
export const MOVE_IN_HANDOVER_TEMPLATE_KEY = 'move-in-handover'

export const HANDOVER_TEMPLATE_MAX_ITEMS = 100

export type HandoverTemplateInventoryDefault = {
  name: string
  quantity: number
}

export type HandoverTemplateChecklistItem = {
  id: string
  label: string
}

/** Nội dung mẫu: danh mục đồ nạp sẵn và các mục kiểm tra khi bàn giao. */
export type HandoverTemplateContent = {
  inventoryDefaults: HandoverTemplateInventoryDefault[]
  checklist: HandoverTemplateChecklistItem[]
}

export type HandoverTemplateView = HandoverTemplateContent & {
  key: string
  status: 'draft' | 'published' | 'archived'
  version: number | null
  draftRevision: number
  contentHash: string | null
  publishedAt: Date | null
}

/** Mẫu mặc định: không có đồ nạp sẵn, checklist cơ bản của một biên bản bàn giao nhà. */
export const DEFAULT_HANDOVER_TEMPLATE: HandoverTemplateContent = {
  inventoryDefaults: [],
  checklist: [
    { id: 'meters-recorded', label: 'Đã ghi chỉ số điện, nước' },
    { id: 'keys-handed', label: 'Đã bàn giao đủ chìa khóa' },
    { id: 'condition-checked', label: 'Đã kiểm tra hiện trạng căn hộ' },
    {
      id: 'inventory-checked',
      label: 'Đã đối chiếu danh mục thiết bị, nội thất',
    },
  ],
}

export function normalizeHandoverTemplateContent(
  content: HandoverTemplateContent
): HandoverTemplateContent {
  return {
    inventoryDefaults: content.inventoryDefaults.map(item => ({
      name: item.name.trim(),
      quantity: item.quantity,
    })),
    checklist: content.checklist.map(item => ({
      id: item.id.trim(),
      label: item.label.trim(),
    })),
  }
}

export function computeHandoverTemplateHash(
  content: HandoverTemplateContent,
  version: number
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        version,
        ...normalizeHandoverTemplateContent(content),
      })
    )
    .digest('hex')
}
