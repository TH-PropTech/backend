/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ObjectId } from 'mongodb'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { DeviceBindingService } from './device-binding.service'
import { DeviceStatus } from '../enums/device-status.enum'

type Doc = Record<string, any>
type Harness = {
  service: DeviceBindingService
  repo: { save: jest.Mock; updateOne: jest.Mock; findOne: jest.Mock }
  users: [Doc]
  userId: string
}

function getPath(doc: Doc, path: string): any {
  return path
    .split('.')
    .reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), doc)
}

function matchCond(value: any, cond: any): boolean {
  if (cond instanceof ObjectId) return cond.equals(value)
  if (cond === null) return value === null || value === undefined
  if (cond && typeof cond === 'object') {
    if ('$exists' in cond) return (value !== undefined) === cond.$exists
    if ('$ne' in cond) return value !== cond.$ne
    if ('$elemMatch' in cond) {
      return (
        Array.isArray(value) &&
        value.some(el =>
          Object.entries(cond.$elemMatch).every(([k, c]) => matchCond(el[k], c))
        )
      )
    }
  }
  return value === cond
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Doc[]).some(f => matches(doc, f))
    const dot = key.lastIndexOf('.')
    const parent = dot > 0 ? getPath(doc, key.slice(0, dot)) : undefined
    if (Array.isArray(parent)) {
      // Mongo array semantics: "arr.field" matches if any element matches
      const field = key.slice(dot + 1)
      const hits = parent.map(el => el?.[field])
      return cond && typeof cond === 'object' && '$ne' in cond
        ? !hits.includes(cond.$ne)
        : hits.some(h => matchCond(h, cond))
    }
    return matchCond(getPath(doc, key), cond)
  })
}

// Applies "a.b.$.c" using the element selected by the query filter.
function applySet(doc: Doc, filter: Doc, path: string, value: any): void {
  const marker = path.indexOf('.$.')
  if (marker === -1) {
    const parts = path.split('.')
    let node = doc
    for (const part of parts.slice(0, -1)) node = node[part] ??= {}
    node[parts[parts.length - 1] as string] = value
    return
  }
  const arrPath = path.slice(0, marker)
  const field = path.slice(marker + 3)
  const arr = getPath(doc, arrPath) as Doc[]
  const elem = filter[arrPath]?.$elemMatch
  const index = arr.findIndex(el =>
    elem
      ? Object.entries(elem).every(([k, c]) => matchCond(el[k], c))
      : el.deviceId === filter[`${arrPath}.deviceId`]
  )
  ;(arr[index] as Doc)[field] = value
}

function cloneKeepingObjectIds<T>(value: T): T {
  if (value instanceof ObjectId) return value
  if (value instanceof Date) return new Date(value.getTime()) as T
  if (Array.isArray(value)) return value.map(cloneKeepingObjectIds) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, cloneKeepingObjectIds(v)])
    ) as T
  }
  return value
}

// In-memory fake of MongoRepository<User> implementing only the operators the
// service relies on: findOne, updateOne with $set (incl. positional), $push, $inc.
function makeHarness(initialUser: Doc | 'none' = {}): Harness {
  const oid = new ObjectId()
  const users = (initialUser === 'none'
    ? []
    : [{ _id: oid, ...initialUser }]) as unknown as [Doc]
  const repo = {
    findOne: jest.fn(({ where }: { where: Doc }) => {
      const found = users.find(u => matches(u, where))
      return Promise.resolve(found ? cloneKeepingObjectIds(found) : null)
    }),
    updateOne: jest.fn((filter: Doc, update: Doc) => {
      const doc = users.find(u => matches(u, filter))
      if (!doc) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 })
      for (const [k, v] of Object.entries(update.$set ?? {})) {
        applySet(doc, filter, k, v)
      }
      for (const [k, v] of Object.entries(update.$push ?? {})) {
        const arr = getPath(doc, k) as unknown[]
        arr.push(v)
      }
      for (const [k, v] of Object.entries(update.$inc ?? {})) {
        applySet(doc, filter, k, (getPath(doc, k) ?? 0) + (v as number))
      }
      return Promise.resolve({ matchedCount: 1, modifiedCount: 1 })
    }),
    save: jest.fn(),
  }
  const service = new DeviceBindingService(repo as never)
  return { service, repo, users, userId: oid.toHexString() }
}

describe('DeviceBindingService (embedded User.smartOTP.devices)', () => {
  it('binds a new device as ACTIVE and returns the entity shape', async () => {
    const { service, userId } = makeHarness()
    const result = await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    expect(result).toMatchObject({
      userId,
      deviceId: 'd1',
      deviceName: 'Phone',
      publicKey: 'KEY1',
      status: DeviceStatus.ACTIVE,
    })
    expect(result._id).toBeDefined()
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.updatedAt).toBeInstanceOf(Date)
  })

  it('re-binding an existing device updates name/key, forces ACTIVE and keeps one record', async () => {
    const { service, userId } = makeHarness()
    const first = await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    const second = await service.bindDevice(userId, 'd1', 'Phone 2', 'KEY2')
    expect(second).toMatchObject({
      deviceId: 'd1',
      deviceName: 'Phone 2',
      publicKey: 'KEY2',
      status: DeviceStatus.ACTIVE,
    })
    expect(second._id).toEqual(first._id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(await service.getUserDevices(userId)).toHaveLength(1)
  })

  it('rejects binding a BLOCKED device with 400 and leaves it untouched', async () => {
    const { service, userId } = makeHarness()
    await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    await service.blockDevice(userId, 'd1')
    await expect(
      service.bindDevice(userId, 'd1', 'Hacker', 'KEY9')
    ).rejects.toThrow(BadRequestException)
    await expect(
      service.bindDevice(userId, 'd1', 'Hacker', 'KEY9')
    ).rejects.toThrow('Thiết bị này đã bị khóa trên hệ thống')
    const stored = await service.getDeviceBinding(userId, 'd1')
    expect(stored).toMatchObject({
      deviceName: 'Phone',
      publicKey: 'KEY1',
      status: DeviceStatus.BLOCKED,
    })
  })

  it('getDeviceBinding returns the device or null', async () => {
    const { service, userId } = makeHarness()
    await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    expect(await service.getDeviceBinding(userId, 'd1')).toMatchObject({
      deviceId: 'd1',
      publicKey: 'KEY1',
    })
    expect(await service.getDeviceBinding(userId, 'nope')).toBeNull()
    expect(
      await service.getDeviceBinding(new ObjectId().toHexString(), 'd1')
    ).toBeNull()
  })

  it('two consecutive binds of different devices keep both', async () => {
    const { service, userId } = makeHarness()
    await service.bindDevice(userId, 'd1', 'A', 'K1')
    await service.bindDevice(userId, 'd2', 'B', 'K2')
    const devices = await service.getUserDevices(userId)
    expect(devices.map(d => d.deviceId).sort()).toEqual(['d1', 'd2'])
  })

  it('blockDevice / activateDevice flip the status', async () => {
    const { service, userId } = makeHarness()
    await service.bindDevice(userId, 'd1', 'A', 'K1')
    await service.blockDevice(userId, 'd1')
    expect((await service.getDeviceBinding(userId, 'd1'))?.status).toBe(
      DeviceStatus.BLOCKED
    )
    await service.activateDevice(userId, 'd1')
    expect((await service.getDeviceBinding(userId, 'd1'))?.status).toBe(
      DeviceStatus.ACTIVE
    )
  })

  it('blockDevice / activateDevice throw NotFound for an unknown device', async () => {
    const { service, userId } = makeHarness()
    await expect(service.blockDevice(userId, 'nope')).rejects.toThrow(
      NotFoundException
    )
    await expect(service.activateDevice(userId, 'nope')).rejects.toThrow(
      'Không tìm thấy thiết bị liên kết'
    )
  })

  it('response keeps the legacy entity shape (ObjectId _id, userId, dates)', async () => {
    const { service, userId } = makeHarness()
    const result = await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    expect(Object.keys(result).sort()).toEqual(
      [
        '_id',
        'createdAt',
        'deviceId',
        'deviceName',
        'publicKey',
        'status',
        'updatedAt',
        'userId',
      ].sort()
    )
    expect(result._id).toBeInstanceOf(ObjectId)
    expect(result.userId).toBe(userId)
    expect((await service.getDeviceBinding(userId, 'd1'))?._id).toEqual(
      result._id
    )
  })

  it('returns the stored bindingId as _id (legacy id kept by migration 007)', async () => {
    const legacyId = new ObjectId()
    const { service, userId } = makeHarness({
      smartOTP: {
        enabled: false,
        maxDevices: 1,
        registeredDevices: 1,
        otpAttempts: 0,
        devices: [
          {
            bindingId: legacyId,
            deviceId: 'old',
            deviceName: 'Old',
            publicKey: 'K',
            status: DeviceStatus.ACTIVE,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    })
    expect((await service.getDeviceBinding(userId, 'old'))?._id).toEqual(
      legacyId
    )
    const rebound = await service.bindDevice(userId, 'old', 'Old2', 'K2')
    expect(rebound._id).toEqual(legacyId)
  })

  it('persists a generated bindingId for newly bound devices', async () => {
    const { service, users, userId } = makeHarness()
    const result = await service.bindDevice(userId, 'd1', 'Phone', 'KEY1')
    const stored = (
      users[0]?.smartOTP as { devices: Array<{ bindingId?: ObjectId }> }
    ).devices[0]
    expect(stored?.bindingId).toBeInstanceOf(ObjectId)
    expect(result._id).toEqual(stored?.bindingId)
  })

  it('syncs smartOTP.registeredDevices only when a device is added', async () => {
    const { service, users, userId } = makeHarness({
      smartOTP: {
        enabled: false,
        maxDevices: 1,
        registeredDevices: 0,
        otpAttempts: 0,
      },
    })
    await service.bindDevice(userId, 'd1', 'A', 'K1')
    await service.bindDevice(userId, 'd1', 'A2', 'K1b')
    await service.bindDevice(userId, 'd2', 'B', 'K2')
    expect(users[0].smartOTP.registeredDevices).toBe(2)
    expect(users[0].smartOTP.devices).toHaveLength(2)
    expect(users[0].smartOTP.maxDevices).toBe(1) // no new device limit
  })

  it('initialises default smartOTP for a legacy user without it', async () => {
    const { service, users, userId } = makeHarness({ email: 'a@b.c' })
    await service.bindDevice(userId, 'd1', 'A', 'K1')
    expect(users[0].smartOTP).toMatchObject({
      enabled: false,
      maxDevices: 1,
      registeredDevices: 1,
      otpAttempts: 0,
    })
    expect(users[0].smartOTP.devices).toHaveLength(1)
    expect(users[0].email).toBe('a@b.c')
  })

  it('initialises defaults when smartOTP is null, keeps existing fields otherwise', async () => {
    const a = makeHarness({ smartOTP: null })
    await a.service.bindDevice(a.userId, 'd1', 'A', 'K1')
    expect(a.users[0].smartOTP.devices).toHaveLength(1)

    const b = makeHarness({
      smartOTP: {
        enabled: true,
        maxDevices: 3,
        registeredDevices: 0,
        otpAttempts: 2,
      },
    })
    await b.service.bindDevice(b.userId, 'd1', 'A', 'K1')
    expect(b.users[0].smartOTP).toMatchObject({
      enabled: true,
      maxDevices: 3,
      otpAttempts: 2,
      registeredDevices: 1,
    })
  })

  it('reads on a user without smartOTP return null / empty; block throws NotFound', async () => {
    const { service, userId } = makeHarness({})
    expect(await service.getDeviceBinding(userId, 'd1')).toBeNull()
    expect(await service.getUserDevices(userId)).toEqual([])
    await expect(service.blockDevice(userId, 'd1')).rejects.toThrow(
      NotFoundException
    )
  })

  it('concurrent binds of the same device keep a single embedded entry', async () => {
    const { service, users, userId } = makeHarness({})
    await Promise.all([
      service.bindDevice(userId, 'd1', 'A', 'K1'),
      service.bindDevice(userId, 'd1', 'A', 'K1'),
      service.bindDevice(userId, 'd1', 'A', 'K1'),
    ])
    expect(users[0].smartOTP.devices).toHaveLength(1)
    expect(users[0].smartOTP.registeredDevices).toBe(1)
  })

  it('never writes through save(User) and only uses atomic operators', async () => {
    const { service, repo, userId } = makeHarness({})
    await service.bindDevice(userId, 'd1', 'A', 'K1')
    await service.bindDevice(userId, 'd1', 'A2', 'K2')
    await service.blockDevice(userId, 'd1')
    await service.activateDevice(userId, 'd1')
    expect(repo.save).not.toHaveBeenCalled()
    for (const [, update] of repo.updateOne.mock.calls) {
      expect(Object.keys(update).every(k => k.startsWith('$'))).toBe(true)
    }
  })

  it('bind for a missing / invalid user fails instead of creating orphan data', async () => {
    const missing = makeHarness('none')
    await expect(
      missing.service.bindDevice(new ObjectId().toHexString(), 'd1', 'A', 'K')
    ).rejects.toThrow(NotFoundException)
    await expect(
      missing.service.bindDevice('not-an-id', 'd1', 'A', 'K')
    ).rejects.toThrow(BadRequestException)
    expect(await missing.service.getDeviceBinding('not-an-id', 'd1')).toBeNull()
  })
})
