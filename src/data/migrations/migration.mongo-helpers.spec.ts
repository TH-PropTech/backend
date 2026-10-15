import {
  isIndexNotFoundError,
  isNamespaceNotFoundError,
  safeDropIndex,
  safeIndexes,
} from './migration.mongo-helpers'

/** Giống lỗi `MongoServerError` của driver khi namespace chưa tồn tại. */
function namespaceNotFound(): Error {
  return Object.assign(
    new Error('ns does not exist: proptech.smartca_signing_sessions'),
    {
      code: 26,
      codeName: 'NamespaceNotFound',
    }
  )
}

function serverError(code: number, codeName: string): Error {
  return Object.assign(new Error(`${codeName} (${code})`), { code, codeName })
}

describe('migration.mongo-helpers', () => {
  describe('error classification', () => {
    it('recognises NamespaceNotFound by code 26 or codeName', () => {
      expect(isNamespaceNotFoundError(namespaceNotFound())).toBe(true)
      expect(
        isNamespaceNotFoundError(
          Object.assign(new Error('x'), { codeName: 'NamespaceNotFound' })
        )
      ).toBe(true)
      expect(isNamespaceNotFoundError(serverError(13, 'Unauthorized'))).toBe(
        false
      )
      expect(isNamespaceNotFoundError(new Error('no index'))).toBe(false)
      expect(isNamespaceNotFoundError('ns does not exist')).toBe(false)
      expect(isNamespaceNotFoundError(null)).toBe(false)
    })

    it('treats IndexNotFound (27) and NamespaceNotFound (26) as missing index', () => {
      expect(isIndexNotFoundError(serverError(27, 'IndexNotFound'))).toBe(true)
      expect(
        isIndexNotFoundError(Object.assign(new Error('x'), { code: 27 }))
      ).toBe(true)
      expect(isIndexNotFoundError(namespaceNotFound())).toBe(true)
      expect(isIndexNotFoundError(serverError(11000, 'DuplicateKey'))).toBe(
        false
      )
    })
  })

  describe('safeIndexes', () => {
    it('returns the index list when the collection exists', async () => {
      const indexes = [{ name: '_id_' }]
      await expect(
        safeIndexes({ indexes: () => Promise.resolve(indexes) })
      ).resolves.toEqual(indexes)
    })

    it('returns [] when the driver reports NamespaceNotFound', async () => {
      await expect(
        safeIndexes({ indexes: () => Promise.reject(namespaceNotFound()) })
      ).resolves.toEqual([])
    })

    it('rethrows other errors', async () => {
      const denied = serverError(13, 'Unauthorized')
      await expect(
        safeIndexes({ indexes: () => Promise.reject(denied) })
      ).rejects.toBe(denied)
    })
  })

  describe('safeDropIndex', () => {
    it('returns true when the index is dropped', async () => {
      const dropped: string[] = []
      await expect(
        safeDropIndex(
          {
            dropIndex: name => {
              dropped.push(name)
              return Promise.resolve()
            },
          },
          'idx'
        )
      ).resolves.toBe(true)
      expect(dropped).toEqual(['idx'])
    })

    it('returns false for IndexNotFound and NamespaceNotFound', async () => {
      await expect(
        safeDropIndex(
          {
            dropIndex: () => Promise.reject(serverError(27, 'IndexNotFound')),
          },
          'idx'
        )
      ).resolves.toBe(false)
      await expect(
        safeDropIndex(
          { dropIndex: () => Promise.reject(namespaceNotFound()) },
          'idx'
        )
      ).resolves.toBe(false)
    })

    it('rethrows other errors', async () => {
      const boom = serverError(11000, 'DuplicateKey')
      await expect(
        safeDropIndex({ dropIndex: () => Promise.reject(boom) }, 'idx')
      ).rejects.toBe(boom)
    })
  })
})
