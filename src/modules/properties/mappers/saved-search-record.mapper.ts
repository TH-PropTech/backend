import type { ObjectId } from 'typeorm'
import type {
  AlertFrequency,
  SavedSearchFilters,
} from '../schemas/saved-search.schema'
import type { AlertTriggerType } from '../schemas/search-alert.schema'
import type { SavedSearchRecord } from '../schemas/saved-search-record.schema'

/** Hình JSON cũ của SavedSearch (không lộ `kind`). */
export type SavedSearchView = {
  _id: ObjectId
  userId: string
  name: string
  filters: SavedSearchFilters
  alertEnabled: boolean
  alertFrequency: AlertFrequency
  lastAlertSentAt?: Date
  matchCount: number
  createdAt: Date
  updatedAt: Date
}

/** Hình JSON cũ của SearchAlert (không lộ `kind`; không có updatedAt). */
export type SearchAlertView = {
  _id: ObjectId
  savedSearchId: string
  userId: string
  apartmentId: string
  apartmentTitle: string
  triggerType: AlertTriggerType
  matchReason: string
  previousValue?: string
  newValue?: string
  isRead: boolean
  isDismissed: boolean
  deduplicationKey: string
  createdAt: Date
}

const SEARCH_FIELDS = [
  '_id',
  'userId',
  'name',
  'filters',
  'alertEnabled',
  'alertFrequency',
  'lastAlertSentAt',
  'matchCount',
  'createdAt',
  'updatedAt',
] as const

const ALERT_FIELDS = [
  '_id',
  'savedSearchId',
  'userId',
  'apartmentId',
  'apartmentTitle',
  'triggerType',
  'matchReason',
  'previousValue',
  'newValue',
  'isRead',
  'isDismissed',
  'deduplicationKey',
  'createdAt',
] as const

/** Chỉ giữ các khóa có giá trị (khác undefined) để JSON khớp hình cũ. */
function pick(source: SavedSearchRecord, fields: readonly string[]): unknown {
  const view: Record<string, unknown> = {}
  const record = source as unknown as Record<string, unknown>
  for (const field of fields) {
    if (record[field] !== undefined) view[field] = record[field]
  }
  return view
}

export function toSavedSearchView(record: SavedSearchRecord): SavedSearchView {
  return pick(record, SEARCH_FIELDS) as SavedSearchView
}

export function toSearchAlertView(record: SavedSearchRecord): SearchAlertView {
  return pick(record, ALERT_FIELDS) as SearchAlertView
}
