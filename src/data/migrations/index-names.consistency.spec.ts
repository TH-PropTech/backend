import { getMetadataArgsStorage } from 'typeorm'
import { COMMUNITY_ENTRY_INDEXES } from './009-community-entries-merge'
import { CONTRACT_DOCUMENT_INDEXES } from './011-contract-documents-merge'
import { RENTAL_FLOW_CONFIG_INDEXES } from './014-rental-flow-configs-merge'
import { REVIEW_CASE_INDEXES } from './015-review-cases-merge'
import { SAVED_SEARCH_RECORD_INDEXES } from './016-saved-searches-merge'
import { SYSTEM_CONFIG_INDEX } from './013-merge-system-configs'
import { CommunityEntry } from '../../modules/community/schemas/community-entry.schema'
import { ContractDocument } from '../../modules/contracts/schemas/contract-document.schema'
import { ReviewCase } from '../../modules/properties/schemas/review-case.schema'
import { SavedSearchRecord } from '../../modules/properties/schemas/saved-search-record.schema'
import { SystemConfig } from '../../modules/properties/schemas/system-config.schema'
import { RentalFlowConfig } from '../../modules/rental/schemas/rental-flow-config.schema'

/**
 * Đảm bảo tên `@Index` trong entity TRÙNG tên `createIndex` mà migration tạo.
 * Nếu lệch, với DATABASE_SYNCHRONIZE=true TypeORM tạo chỉ mục khác tên cùng khóa
 * và Mongo báo IndexOptionsConflict (code 85).
 *
 * Chỉ so các chỉ mục KHÔNG partial (TypeORM không khai báo được partialFilterExpression).
 */

type MigrationIndex = {
  readonly name: string
  readonly keys: Record<string, 1 | -1>
  readonly unique?: boolean
  readonly options?: Record<string, unknown>
  readonly partialFilterExpression?: unknown
}

function plainIndexes(
  list: ReadonlyArray<MigrationIndex>
): Array<{ name: string; columns: string[]; unique: boolean }> {
  return list
    .filter(
      i =>
        i.partialFilterExpression === undefined &&
        i.options?.partialFilterExpression === undefined
    )
    .map(i => ({
      name: i.name,
      columns: Object.keys(i.keys),
      unique: i.unique === true || i.options?.unique === true,
    }))
}

function entityIndexes(
  target: abstract new (...args: never[]) => unknown
): Array<{
  name: string | undefined
  columns: string[]
  unique: boolean
}> {
  return getMetadataArgsStorage()
    .indices.filter(i => i.target === target)
    .map(i => ({
      name: i.name,
      columns: Array.isArray(i.columns) ? [...i.columns] : [],
      unique: i.unique === true,
    }))
}

/**
 * Hằng chép tay từ migration 022 (SCOPE_KEY_INDEX không export).
 * Phải giữ cùng tên và khóa với 013 (SYSTEM_CONFIG_INDEX) và 022.
 */
const SYSTEM_CONFIG_SCOPE_KEY_022: MigrationIndex = {
  name: 'system_configs_scope_key_unique',
  keys: { scope: 1, key: 1 },
  unique: true,
}

const CASES: ReadonlyArray<{
  label: string
  entity: abstract new (...args: never[]) => unknown
  migrationIndexes: ReadonlyArray<MigrationIndex>
}> = [
  {
    label: 'CommunityEntry (009)',
    entity: CommunityEntry,
    migrationIndexes: COMMUNITY_ENTRY_INDEXES,
  },
  {
    label: 'ContractDocument (011)',
    entity: ContractDocument,
    migrationIndexes: CONTRACT_DOCUMENT_INDEXES,
  },
  {
    label: 'ReviewCase (015)',
    entity: ReviewCase,
    migrationIndexes: REVIEW_CASE_INDEXES,
  },
  {
    label: 'SavedSearchRecord (016)',
    entity: SavedSearchRecord,
    migrationIndexes: SAVED_SEARCH_RECORD_INDEXES,
  },
  {
    label: 'SystemConfig (013 + 022)',
    entity: SystemConfig,
    migrationIndexes: [
      { ...SYSTEM_CONFIG_INDEX, unique: true },
      SYSTEM_CONFIG_SCOPE_KEY_022,
    ],
  },
  {
    label: 'RentalFlowConfig (014)',
    entity: RentalFlowConfig,
    migrationIndexes: RENTAL_FLOW_CONFIG_INDEXES,
  },
]

describe('Tên chỉ mục entity khớp migration', () => {
  it.each(CASES)(
    '$label: mọi chỉ mục không partial đều khai báo đúng tên và khóa',
    ({ entity, migrationIndexes }) => {
      const declared = entityIndexes(entity)
      for (const expected of plainIndexes(migrationIndexes)) {
        const match = declared.find(d => d.name === expected.name)
        expect(match).toEqual({
          name: expected.name,
          columns: expected.columns,
          unique: expected.unique,
        })
      }
    }
  )

  it('không có tên chỉ mục trùng khóa khác tên trong cùng entity', () => {
    for (const { entity } of CASES) {
      const declared = entityIndexes(entity)
      const keyOf = (d: { columns: string[]; unique: boolean }): string =>
        `${d.unique ? 'U' : 'N'}:${d.columns.join(',')}`
      const keys = declared.map(keyOf)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})
