/**
 * Helper dùng chung cho migration Mongo. Driver thật ném `MongoServerError` khi
 * collection/namespace chưa tồn tại (ví dụ `Collection.indexes()` gọi `listIndexes`
 * trên collection chưa có, hoặc `dropIndex` trên namespace chưa có), trong khi fake
 * trong spec trả mảng rỗng. Các hàm dưới đây coi lỗi "chưa có" là trạng thái rỗng để
 * dry-run, apply và rollback không văng trên môi trường mới.
 */

/** Mã lỗi server: namespace (collection/database) chưa tồn tại. */
export const MONGO_NAMESPACE_NOT_FOUND_CODE = 26
/** Mã lỗi server: chỉ mục cần gỡ không tồn tại. */
export const MONGO_INDEX_NOT_FOUND_CODE = 27

const NAMESPACE_NOT_FOUND = 'NamespaceNotFound'
const INDEX_NOT_FOUND = 'IndexNotFound'

/** Tập con của `Collection` cần để liệt kê chỉ mục. */
export interface IndexListingCollection<TIndex> {
  indexes(): Promise<TIndex[]>
}

/** Tập con của `Collection` cần để gỡ chỉ mục. */
export interface DroppableIndexCollection {
  dropIndex(name: string): Promise<unknown>
}

function errorCodeOf(error: unknown): {
  code: unknown
  codeName: unknown
} {
  if (typeof error !== 'object' || error === null) {
    return { code: undefined, codeName: undefined }
  }
  const candidate = error as { code?: unknown; codeName?: unknown }
  return { code: candidate.code, codeName: candidate.codeName }
}

/** Lỗi "namespace chưa tồn tại" (code 26 hoặc codeName `NamespaceNotFound`). */
export function isNamespaceNotFoundError(error: unknown): boolean {
  const { code, codeName } = errorCodeOf(error)
  return (
    code === MONGO_NAMESPACE_NOT_FOUND_CODE || codeName === NAMESPACE_NOT_FOUND
  )
}

/**
 * Lỗi "chỉ mục không tồn tại" (code 27 / `IndexNotFound`). Khi cả namespace chưa có
 * thì chỉ mục cũng không có, nên lỗi 26 được tính luôn.
 */
export function isIndexNotFoundError(error: unknown): boolean {
  const { code, codeName } = errorCodeOf(error)
  return (
    code === MONGO_INDEX_NOT_FOUND_CODE ||
    codeName === INDEX_NOT_FOUND ||
    isNamespaceNotFoundError(error)
  )
}

/**
 * Liệt kê chỉ mục; collection chưa tồn tại trả `[]`. Lỗi khác vẫn ném.
 */
export async function safeIndexes<TIndex>(
  collection: IndexListingCollection<TIndex>
): Promise<TIndex[]> {
  try {
    return await collection.indexes()
  } catch (error) {
    if (isNamespaceNotFoundError(error)) return []
    throw error
  }
}

/**
 * Gỡ chỉ mục theo tên. Trả `true` khi đã gỡ, `false` khi chỉ mục hoặc collection
 * chưa tồn tại (code 27/26). Lỗi khác vẫn ném.
 */
export async function safeDropIndex(
  collection: DroppableIndexCollection,
  name: string
): Promise<boolean> {
  try {
    await collection.dropIndex(name)
    return true
  } catch (error) {
    if (isIndexNotFoundError(error)) return false
    throw error
  }
}
