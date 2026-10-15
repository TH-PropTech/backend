/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ObjectId } from 'mongodb'
import {
  migrateDeviceBindingsToUsers,
  rollbackDeviceBindingsEmbed,
  type DeviceBindingsMigrationDb,
  type EmbeddedDevice,
  type LegacyDeviceBinding,
  type UserSmartOtpDoc,
} from './007-device-bindings-embed'

function makeDb(
  bindings: LegacyDeviceBinding[],
  users: UserSmartOtpDoc[]
): DeviceBindingsMigrationDb {
  const find = (id: ObjectId): UserSmartOtpDoc | undefined =>
    users.find(u => u._id.equals(id))
  const db: DeviceBindingsMigrationDb = {
    readBindings: () => Promise.resolve(bindings),
    readUsersWithDevices: () =>
      Promise.resolve(
        users
          .filter(u => (u.smartOTP?.devices ?? []).length)
          .map(u => ({
            ...structuredClone(u),
            _id: u._id,
            smartOTP: {
              ...structuredClone(u.smartOTP),
              devices: (u.smartOTP?.devices ?? []).map(d => ({ ...d })),
            },
          }))
      ),
    upsertBinding: b => {
      const idx = bindings.findIndex(
        x => x.userId === b.userId && x.deviceId === b.deviceId
      )
      if (idx >= 0) {
        const prev = bindings[idx] as LegacyDeviceBinding
        bindings[idx] = {
          ...prev,
          deviceName: b.deviceName,
          publicKey: b.publicKey,
          status: b.status,
          ...(b.updatedAt ? { updatedAt: b.updatedAt } : {}),
        }
      } else {
        bindings.push({ ...b })
      }
      return Promise.resolve()
    },
    findUser: id => {
      const user = find(id)
      return Promise.resolve(user ? structuredClone(user) : null)
    },
    updateUser: (filter, update) => {
      const user = find(filter._id as ObjectId)
      if (!user) return Promise.resolve({ matchedCount: 0 })
      const so = user.smartOTP
      const f = filter as Record<string, any>
      if (f.$or && so) return Promise.resolve({ matchedCount: 0 })
      if (f['smartOTP.devices'] && so?.devices)
        return Promise.resolve({ matchedCount: 0 })
      const ne = f['smartOTP.devices.deviceId']?.$ne
      if (ne && so?.devices?.some(d => d.deviceId === ne))
        return Promise.resolve({ matchedCount: 0 })
      const u = update as Record<string, any>
      if (u.$set?.smartOTP) user.smartOTP = structuredClone(u.$set.smartOTP)
      if (u.$set?.['smartOTP.devices'] && user.smartOTP)
        user.smartOTP.devices = []
      if (u.$push && user.smartOTP) {
        user.smartOTP.devices ??= []
        user.smartOTP.devices.push(
          u.$push['smartOTP.devices'] as EmbeddedDevice
        )
      }
      if (u.$pull && user.smartOTP) {
        const pid = u.$pull['smartOTP.devices'].deviceId
        user.smartOTP.devices = (user.smartOTP.devices ?? []).filter(
          d => d.deviceId !== pid
        )
      }
      if (u.$inc && user.smartOTP) {
        user.smartOTP.registeredDevices =
          (user.smartOTP.registeredDevices ?? 0) +
          u.$inc['smartOTP.registeredDevices']
      }
      return Promise.resolve({ matchedCount: 1 })
    },
  }
  return db
}

const day = (n: number): Date => new Date(2026, 0, n)
function binding(userId: string, deviceId: string, d = 1): LegacyDeviceBinding {
  return {
    _id: new ObjectId(),
    userId,
    deviceId,
    deviceName: `n-${deviceId}`,
    publicKey: `k-${deviceId}`,
    status: 'ACTIVE',
    createdAt: day(d),
    updatedAt: day(d),
  }
}

describe('007 device bindings embed migration', () => {
  const u1 = new ObjectId()
  const u2 = new ObjectId()
  const u1s = u1.toHexString()
  const u2s = u2.toHexString()
  const fixture = (): {
    bindings: LegacyDeviceBinding[]
    users: UserSmartOtpDoc[]
  } => ({
    bindings: [
      binding(u1s, 'a'),
      binding(u1s, 'b'),
      binding(u2s, 'c'),
      binding(new ObjectId().toHexString(), 'orphan'),
    ],
    users: [
      { _id: u1, smartOTP: { registeredDevices: 0 } },
      { _id: u2 }, // legacy user without smartOTP
    ] as UserSmartOtpDoc[],
  })

  it('dry-runs by default without writing', async () => {
    const { bindings, users } = fixture()
    const snapshot = structuredClone(users)
    const report = await migrateDeviceBindingsToUsers(makeDb(bindings, users))
    expect(report).toMatchObject({
      dryRun: true,
      scanned: 4,
      embedded: 3,
      backfilledUsers: 1,
    })
    expect(report.orphans).toHaveLength(1)
    expect(users).toEqual(snapshot)
  })

  it('applies, backfills defaults, syncs counts, verifies, and is idempotent', async () => {
    const { bindings, users } = fixture()
    const db = makeDb(bindings, users)
    const report = await migrateDeviceBindingsToUsers(db, { dryRun: false })
    expect(report).toMatchObject({
      embedded: 3,
      expectedDevices: 3,
      verifiedDevices: 3,
      errors: [],
    })
    expect(users[0]?.smartOTP?.devices?.map(x => x.deviceId)).toEqual([
      'a',
      'b',
    ])
    expect(users[0]?.smartOTP?.registeredDevices).toBe(2)
    expect(users[1]?.smartOTP).toMatchObject({
      enabled: false,
      maxDevices: 1,
      otpAttempts: 0,
      registeredDevices: 1,
    })

    const again = await migrateDeviceBindingsToUsers(db, { dryRun: false })
    expect(again).toMatchObject({ embedded: 0, updated: 0, verifiedDevices: 3 })
    expect(users[0]?.smartOTP?.devices).toHaveLength(2)
    expect(users[0]?.smartOTP?.registeredDevices).toBe(2)
  })

  it('collapses duplicate (userId, deviceId) source rows to the newest', async () => {
    const dup = { ...binding(u1s, 'a', 5), deviceName: 'newest' }
    const users: UserSmartOtpDoc[] = [{ _id: u1 }]
    await migrateDeviceBindingsToUsers(
      makeDb([binding(u1s, 'a', 1), dup], users),
      { dryRun: false }
    )
    expect(users[0]?.smartOTP?.devices).toHaveLength(1)
    expect(users[0]?.smartOTP?.devices?.[0]?.deviceName).toBe('newest')
  })

  it('throws when the post-apply count does not match', async () => {
    const { bindings, users } = fixture()
    const db = makeDb(bindings, users)
    const broken: DeviceBindingsMigrationDb = {
      ...db,
      updateUser: () => Promise.resolve({ matchedCount: 1 }), // writes nothing
    }
    await expect(
      migrateDeviceBindingsToUsers(broken, { dryRun: false })
    ).rejects.toThrow('count mismatch')
  })

  it('keeps the legacy _id as bindingId on the embedded device', async () => {
    const { bindings, users } = fixture()
    await migrateDeviceBindingsToUsers(makeDb(bindings, users), {
      dryRun: false,
    })
    const a = users[0]?.smartOTP?.devices?.find(d => d.deviceId === 'a')
    expect(a?.bindingId?.equals(bindings[0]?._id as ObjectId)).toBe(true)
  })

  it('rollback copies embedded devices back to device_bindings before pulling them', async () => {
    const { bindings, users } = fixture()
    const db = makeDb(bindings, users)
    await migrateDeviceBindingsToUsers(db, { dryRun: false })
    const originalAId = bindings[0]?._id as ObjectId
    // after the code switch: new device bound, and an old one blocked
    users[0]?.smartOTP?.devices?.push({
      deviceId: 'new',
      deviceName: 'n-new',
      publicKey: 'k-new',
      status: 'ACTIVE',
      createdAt: day(2),
      updatedAt: day(2),
    })
    const a = users[0]?.smartOTP?.devices?.find(d => d.deviceId === 'a')
    if (a) {
      a.status = 'BLOCKED'
      a.updatedAt = day(3)
    }
    const snapshot = structuredClone(users)

    const dry = await rollbackDeviceBindingsEmbed(db)
    expect(dry).toMatchObject({ dryRun: true, updated: 4 })
    expect(users).toEqual(snapshot)
    expect(bindings).toHaveLength(4)

    const report = await rollbackDeviceBindingsEmbed(db, { dryRun: false })
    expect(report.updated).toBe(4)
    expect(bindings).toHaveLength(5) // + 'new'; no duplicates for a/b/c
    const backA = bindings.find(b => b.userId === u1s && b.deviceId === 'a')
    expect(backA?.status).toBe('BLOCKED')
    expect(backA?._id.equals(originalAId)).toBe(true)
    expect(bindings.find(b => b.deviceId === 'new')).toMatchObject({
      userId: u1s,
      publicKey: 'k-new',
      status: 'ACTIVE',
    })
    expect(users[0]?.smartOTP?.devices).toEqual([])
    expect(users[1]?.smartOTP?.devices).toEqual([])
  })

  it('rollback does not pull a device whose copy back failed', async () => {
    const { bindings, users } = fixture()
    const db = makeDb(bindings, users)
    await migrateDeviceBindingsToUsers(db, { dryRun: false })
    const failing: DeviceBindingsMigrationDb = {
      ...db,
      upsertBinding: b =>
        b.deviceId === 'b'
          ? Promise.reject(new Error('write failed'))
          : db.upsertBinding(b),
    }
    const report = await rollbackDeviceBindingsEmbed(failing, {
      dryRun: false,
    })
    expect(report.errors).toHaveLength(1)
    expect(users[0]?.smartOTP?.devices?.map(x => x.deviceId)).toEqual(['b'])
  })
})
