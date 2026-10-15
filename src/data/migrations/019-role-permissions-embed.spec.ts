import { ObjectId } from 'mongodb'
import { MAX_ROLE_PERMISSIONS } from '../../modules/rbac/schemas/role.schema'
import {
  migrateRolePermissionsToEmbedded,
  rollbackRolePermissionsEmbed,
  ROLE_PERMISSIONS_EMBED_MIGRATION_ID,
  type MigrationCollection,
  type RolePermissionsMigrationDb,
} from './019-role-permissions-embed'

type Doc = Record<string, unknown>

const isOp = (cond: unknown): cond is Doc =>
  !!cond && typeof cond === 'object' && !(cond instanceof ObjectId)

const eq = (a: unknown, b: unknown): boolean => String(a) === String(b)

/** Giá trị theo đường dẫn; mảng được duyệt từng phần tử (như Mongo). */
function valuesAt(doc: Doc, path: string): unknown[] {
  let values: unknown[] = [doc]
  for (const part of path.split('.')) {
    values = values.flatMap(v => {
      if (Array.isArray(v)) return v.map(x => (x as Doc | undefined)?.[part])
      return [(v as Doc | undefined)?.[part]]
    })
  }
  return values
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const values = valuesAt(doc, key)
    if (isOp(cond)) {
      if ('$in' in cond)
        return values.some(v => (cond.$in as unknown[]).some(x => eq(x, v)))
      if ('$nin' in cond)
        return !values.some(v => (cond.$nin as unknown[]).some(x => eq(x, v)))
      if ('$exists' in cond)
        return values.some(v => v !== undefined) === cond.$exists
    }
    return values.some(v => eq(cond, v))
  })
}

/** Sao chép nông: giữ nguyên ObjectId (structuredClone làm mất prototype). */
function cloneDoc(doc: Doc): Doc {
  const out: Doc = { ...doc }
  if (Array.isArray(doc.permissions)) {
    out.permissions = (doc.permissions as Doc[]).map(p => ({ ...p }))
  }
  return out
}

interface FakeStore {
  docs: Doc[]
  indexes: string[]
}

function fakeCollection(store: FakeStore): MigrationCollection & {
  dump(): Doc[]
} {
  const { docs } = store
  return {
    dump: () => docs.map(cloneDoc),
    find: (filter = {}) => ({
      toArray: () =>
        Promise.resolve(docs.filter(d => matches(d, filter)).map(cloneDoc)),
    }),
    countDocuments: (filter = {}) =>
      Promise.resolve(docs.filter(d => matches(d, filter)).length),
    updateOne: (
      filter: Doc,
      update: Doc
    ): Promise<{ matchedCount: number; modifiedCount?: number }> => {
      const target = docs.find(d => matches(d, filter))
      if (!target) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      const set = update.$set as Doc | undefined
      if (set) Object.assign(target, set)
      const unset = update.$unset as Doc | undefined
      if (unset) for (const key of Object.keys(unset)) delete target[key]
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    },
    replaceOne: (
      filter: Doc,
      doc: Doc,
      options?: { upsert?: boolean }
    ): Promise<{ matchedCount: number; upsertedCount?: number }> => {
      const target = docs.find(d => matches(d, filter))
      if (target) {
        for (const key of Object.keys(target)) delete target[key]
        Object.assign(target, cloneDoc(doc))
        return Promise.resolve({ matchedCount: 1 })
      }
      if (options?.upsert) {
        docs.push(cloneDoc(doc))
        return Promise.resolve({ matchedCount: 0, upsertedCount: 1 })
      }
      return Promise.resolve({ matchedCount: 0 })
    },
    deleteMany: (filter: Doc): Promise<{ deletedCount: number }> => {
      const keep = docs.filter(d => !matches(d, filter))
      const deleted = docs.length - keep.length
      docs.splice(0, docs.length, ...keep)
      return Promise.resolve({ deletedCount: deleted })
    },
    createIndex: (
      _keys: Record<string, 1 | -1>,
      options?: { name?: string }
    ): Promise<string> => {
      store.indexes.push(options?.name ?? 'unnamed')
      return Promise.resolve('ok')
    },
  }
}

function makeDb(seed: { roles: Doc[]; permissions: Doc[] }): {
  db: RolePermissionsMigrationDb
  roles: Doc[]
  permissions: Doc[]
  indexes: { roles: string[]; permissions: string[] }
} {
  const roleStore: FakeStore = { docs: seed.roles.map(cloneDoc), indexes: [] }
  const permStore: FakeStore = {
    docs: seed.permissions.map(cloneDoc),
    indexes: [],
  }
  const stores: Record<string, FakeStore> = {
    roles: roleStore,
    permissions: permStore,
  }
  const collections: Record<string, ReturnType<typeof fakeCollection>> = {}
  const db: RolePermissionsMigrationDb = {
    collection: (name: string) => {
      const existing = collections[name]
      if (existing) return existing
      const store = stores[name] ?? { docs: [], indexes: [] }
      stores[name] = store
      const created = fakeCollection(store)
      collections[name] = created
      return created
    },
  }
  return {
    db,
    roles: roleStore.docs,
    permissions: permStore.docs,
    indexes: { roles: roleStore.indexes, permissions: permStore.indexes },
  }
}

const d = (n: number): Date => new Date(2026, 0, n)

describe('019 role permissions embed migration', () => {
  const r1 = new ObjectId()
  const r2 = new ObjectId()
  const orphanRole = new ObjectId()
  const p1 = new ObjectId()
  const p2 = new ObjectId()
  const p3 = new ObjectId()
  const p4 = new ObjectId()

  const fixture = (): { roles: Doc[]; permissions: Doc[] } => ({
    roles: [
      {
        _id: r1,
        name: 'tenant',
        isSystem: true,
        createdAt: d(1),
        updatedAt: d(1),
      },
      {
        _id: r2,
        name: 'custom',
        isSystem: false,
        createdAt: d(1),
        updatedAt: d(1),
      },
    ],
    permissions: [
      {
        _id: p1,
        roleId: r1.toHexString(),
        action: 'read',
        subject: 'User',
        allowed: true,
        createdAt: d(1),
        updatedAt: d(1),
      },
      {
        _id: p2,
        roleId: r1.toHexString(),
        action: 'manage',
        subject: 'Booking',
        allowed: false,
        createdAt: d(1),
        updatedAt: d(1),
      },
      {
        // trùng (action, subject) với p1 nhưng mới hơn: thắng khi khử trùng
        _id: p3,
        roleId: r1.toHexString(),
        action: 'read',
        subject: 'User',
        allowed: false,
        createdAt: d(1),
        updatedAt: d(5),
      },
      {
        _id: p4,
        roleId: orphanRole.toHexString(),
        action: 'read',
        subject: 'all',
        allowed: true,
        createdAt: d(1),
        updatedAt: d(1),
      },
    ],
  })

  it('exports a stable migration id', () => {
    expect(ROLE_PERMISSIONS_EMBED_MIGRATION_ID).toBe(
      '019-role-permissions-embed'
    )
  })

  it('dry-runs by default without writing', async () => {
    const { db, roles, permissions } = makeDb(fixture())
    const rolesBefore = JSON.stringify(roles)
    const permsBefore = permissions.map(cloneDoc)

    const report = await migrateRolePermissionsToEmbedded(db)

    expect(report).toMatchObject({
      migrationId: ROLE_PERMISSIONS_EMBED_MIGRATION_ID,
      dryRun: true,
      scanned: 2,
      sourcePermissions: 4,
      embeddedPermissions: 2,
      orphanPermissions: 1,
      backfilledRoles: 1,
      errors: [],
    })
    expect(report.orphanRoleIds).toEqual([orphanRole.toHexString()])
    expect(JSON.stringify(roles)).toBe(rolesBefore)
    expect(permissions).toEqual(permsBefore)
  })

  it('applies: embeds deduplicated permissions keeping legacy _id, backfills empty roles, verifies', async () => {
    const { db, roles, permissions } = makeDb(fixture())

    const report = await migrateRolePermissionsToEmbedded(db, { dryRun: false })

    expect(report).toMatchObject({
      dryRun: false,
      embeddedPermissions: 2,
      expectedPermissions: 2,
      verifiedPermissions: 2,
      errors: [],
    })
    const tenant = roles.find(r => (r._id as ObjectId).equals(r1))
    const custom = roles.find(r => (r._id as ObjectId).equals(r2))
    const embedded = tenant?.permissions as Doc[]
    expect(embedded).toHaveLength(2)
    // khử trùng: giữ bản mới hơn (p3), `_id` cũ của bản đó được giữ
    expect((embedded[0] as Doc)._id).toEqual(p3)
    expect(embedded[0]).toMatchObject({
      action: 'read',
      subject: 'User',
      allowed: false,
    })
    expect((embedded[1] as Doc)._id).toEqual(p2)
    expect(custom?.permissions).toEqual([])
    // collection nguồn không bị xóa hoặc sửa
    expect(permissions).toHaveLength(4)
  })

  it('is idempotent and never resurrects permissions removed after the code switch', async () => {
    const { db, roles } = makeDb(fixture())
    await migrateRolePermissionsToEmbedded(db, { dryRun: false })

    // sau chuyển code: xóa quyền p2 (manage:Booking), thêm quyền mới
    const tenant = roles.find(r => (r._id as ObjectId).equals(r1)) as Doc
    tenant.permissions = [
      (tenant.permissions as Doc[])[0],
      {
        _id: new ObjectId(),
        action: 'create',
        subject: 'Apartment',
        allowed: true,
        createdAt: d(9),
        updatedAt: d(9),
      },
    ]
    const snapshot = JSON.stringify(roles)

    const again = await migrateRolePermissionsToEmbedded(db, { dryRun: false })

    expect(again).toMatchObject({
      embeddedPermissions: 0,
      updated: 0,
      errors: [],
    })
    expect(JSON.stringify(roles)).toBe(snapshot)
    expect((tenant.permissions as Doc[]).map(p => p.action)).toEqual([
      'read',
      'create',
    ])
  })

  it('reports oversized roles and does not embed them', async () => {
    const big = new ObjectId()
    const permissions: Doc[] = Array.from(
      { length: MAX_ROLE_PERMISSIONS + 1 },
      (_, i) => ({
        _id: new ObjectId(),
        roleId: big.toHexString(),
        action: `a${i}`,
        subject: 'all',
        allowed: true,
        createdAt: d(1),
        updatedAt: d(1),
      })
    )
    const { db, roles } = makeDb({
      roles: [{ _id: big, name: 'huge', createdAt: d(1), updatedAt: d(1) }],
      permissions,
    })

    const report = await migrateRolePermissionsToEmbedded(db, { dryRun: false })

    expect(report.oversizedRoleIds).toEqual([big.toHexString()])
    expect(report.errors).toHaveLength(1)
    expect(roles[0]?.permissions).toBeUndefined()
  })

  it('throws when the post-apply count does not match', async () => {
    const { db } = makeDb(fixture())
    const base = db.collection('roles')
    const broken: RolePermissionsMigrationDb = {
      collection: name =>
        name === 'roles'
          ? {
              ...base,
              updateOne: () =>
                Promise.resolve({ matchedCount: 1, modifiedCount: 0 }),
            }
          : db.collection(name),
    }

    await expect(
      migrateRolePermissionsToEmbedded(broken, { dryRun: false })
    ).rejects.toThrow('count mismatch')
  })

  it('rollback dry-run does not write', async () => {
    const { db, roles, permissions } = makeDb(fixture())
    await migrateRolePermissionsToEmbedded(db, { dryRun: false })
    const rolesSnap = JSON.stringify(roles)
    const permsSnap = permissions.map(cloneDoc)

    const dry = await rollbackRolePermissionsEmbed(db)

    expect(dry).toMatchObject({ dryRun: true, scanned: 2 })
    expect(JSON.stringify(roles)).toBe(rolesSnap)
    expect(permissions).toEqual(permsSnap)
  })

  it('rollback copies embedded permissions back (including post-switch changes), unsets the field, and recreates the unique index', async () => {
    const { db, roles, permissions, indexes } = makeDb(fixture())
    await migrateRolePermissionsToEmbedded(db, { dryRun: false })
    // sau chuyển code: p2 bị xóa khỏi nhúng, thêm quyền mới, p3 đổi allowed
    const tenant = roles.find(r => (r._id as ObjectId).equals(r1)) as Doc
    const embedded = tenant.permissions as Doc[]
    const newId = new ObjectId()
    tenant.permissions = [
      { ...embedded[0], allowed: true, updatedAt: d(7) },
      {
        _id: newId,
        action: 'create',
        subject: 'Apartment',
        allowed: true,
        createdAt: d(8),
        updatedAt: d(8),
      },
    ]

    const report = await rollbackRolePermissionsEmbed(db, { dryRun: false })

    expect(report).toMatchObject({ errors: [] })
    expect(tenant.permissions).toBeUndefined()
    const legacy = permissions.filter(p => p.roleId === r1.toHexString())
    expect(legacy).toHaveLength(2)
    expect(legacy.find(p => (p._id as ObjectId).equals(p2))).toBeUndefined() // stale, removed
    expect(legacy.find(p => (p._id as ObjectId).equals(p3))).toMatchObject({
      action: 'read',
      subject: 'User',
      allowed: true,
    })
    expect(legacy.find(p => p.action === 'create')).toMatchObject({
      subject: 'Apartment',
      _id: newId,
    })
    expect(indexes.permissions).toContain('roleId_1_action_1_subject_1')
    // role đã không còn nhúng: rollback lần hai không làm gì
    const again = await rollbackRolePermissionsEmbed(db, { dryRun: false })
    expect(again).toMatchObject({ scanned: 0, updated: 0 })
  })

  it('rollback keeps a role embedded when its copy back fails', async () => {
    const { db, roles } = makeDb(fixture())
    await migrateRolePermissionsToEmbedded(db, { dryRun: false })
    const base = db.collection('permissions')
    const failing: RolePermissionsMigrationDb = {
      collection: name =>
        name === 'permissions'
          ? {
              ...base,
              replaceOne: (filter, doc, options) =>
                doc.action === 'manage'
                  ? Promise.reject(new Error('write failed'))
                  : base.replaceOne(filter, doc, options),
            }
          : db.collection(name),
    }

    const report = await rollbackRolePermissionsEmbed(failing, {
      dryRun: false,
    })

    expect(report.errors).toHaveLength(1)
    const tenant = roles.find(r => (r._id as ObjectId).equals(r1)) as Doc
    expect((tenant.permissions as Doc[]).map(p => p.action)).toEqual([
      'read',
      'manage',
    ])
  })
})
