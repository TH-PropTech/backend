import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import type { User } from '../../users/schemas/user.schema'
import { DEFAULT_ROLES, RBAC_ACTIONS, RBAC_SUBJECTS } from '../rbac.constants'
import {
  MAX_ROLE_PERMISSIONS,
  type Role,
  type RolePermission,
} from '../schemas/role.schema'
import { RbacService } from './rbac.service'

interface MockRepo {
  find: jest.Mock
  findOne: jest.Mock
  countBy: jest.Mock
  create: jest.Mock
  save: jest.Mock
  delete: jest.Mock
  updateOne: jest.Mock
}

function mockRepo(): MockRepo {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) =>
      Promise.resolve({ _id: new ObjectId(), ...(entity as object) })
    ),
    delete: jest.fn(),
    updateOne: jest
      .fn()
      .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  }
}

interface MockUsers {
  countBy: jest.Mock
  updateMany: jest.Mock
  aggregate: jest.Mock
}

function mockUsers(profile: string | null = null): MockUsers {
  return {
    countBy: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    aggregate: jest.fn(() => ({
      toArray: (): Promise<unknown[]> =>
        Promise.resolve([{ permissionProfile: profile }]),
    })),
  }
}

function embedded(
  action: string,
  subject: string,
  allowed = true,
  overrides: Partial<RolePermission> = {}
): RolePermission {
  return {
    _id: new ObjectId(),
    action,
    subject,
    allowed,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 0, 1),
    ...overrides,
  }
}

function role(overrides: Partial<Role> = {}): Role {
  return {
    _id: new ObjectId(),
    name: 'custom',
    description: '',
    isActive: true,
    isSystem: false,
    permissions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('RbacService', () => {
  let roles: MockRepo
  let users: MockUsers
  let service: RbacService

  const build = (profile: string | null = null): void => {
    users = mockUsers(profile)
    service = new RbacService(
      roles as unknown as MongoRepository<Role>,
      users as unknown as MongoRepository<User>
    )
  }

  beforeEach(() => {
    roles = mockRepo()
    build()
  })

  describe('default roles', () => {
    it('cover exactly the roles used by RolesGuard / @Roles', () => {
      expect(DEFAULT_ROLES.map(r => r.name).sort()).toEqual([
        'admin',
        'landlord',
        'staff',
        'tenant',
      ])
    })
  })

  describe('seedDefaults', () => {
    it('creates every missing role with its permissions embedded in one write', async () => {
      roles.findOne.mockResolvedValue(null)

      const created = await service.seedDefaults()

      expect(created).toEqual(DEFAULT_ROLES.map(r => r.name))
      expect(roles.save).toHaveBeenCalledTimes(DEFAULT_ROLES.length)
      expect(roles.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'admin', isSystem: true })
      )
      const adminDefault = DEFAULT_ROLES.find(r => r.name === 'admin')
      const [saved] = roles.save.mock.calls[0] as [
        { permissions: RolePermission[] },
      ]
      expect(saved.permissions).toHaveLength(
        adminDefault?.permissions.length ?? -1
      )
      expect(saved.permissions[0]?._id).toBeInstanceOf(ObjectId)
      expect(saved.permissions[0]).toMatchObject({
        action: 'manage',
        subject: 'all',
        allowed: true,
      })
    })

    it('is idempotent: existing roles are left untouched', async () => {
      roles.findOne.mockResolvedValue(role({ name: 'admin' }))

      const created = await service.seedDefaults()

      expect(created).toEqual([])
      expect(roles.save).not.toHaveBeenCalled()
      expect(roles.updateOne).not.toHaveBeenCalled()
    })

    it('onModuleInit swallows DB errors', async () => {
      roles.findOne.mockRejectedValue(new Error('mongo down'))
      await expect(service.onModuleInit()).resolves.toBeUndefined()
    })
  })

  describe('roles', () => {
    it('rejects a duplicate role name', async () => {
      roles.countBy.mockResolvedValue(1)
      await expect(service.createRole({ name: 'admin' })).rejects.toThrow(
        ConflictException
      )
      // Mongo: filter thô qua countBy, không bọc trong { where }
      expect(roles.countBy).toHaveBeenCalledWith({ name: 'admin' })
      expect(roles.save).not.toHaveBeenCalled()
    })

    it('allows a role name that no existing role uses', async () => {
      roles.countBy.mockResolvedValue(0)
      await expect(
        service.createRole({ name: 'brand-new' })
      ).resolves.toBeDefined()
      expect(roles.countBy).toHaveBeenCalledWith({ name: 'brand-new' })
    })

    it('creates a non-system role without a response permissions field', async () => {
      const result = await service.createRole({ name: 'auditor' })
      expect(roles.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'auditor',
          isSystem: false,
          permissions: [],
        })
      )
      expect(result).not.toHaveProperty('permissions')
    })

    it('throws NotFound for an invalid or missing id', async () => {
      await expect(service.getRole('not-an-id')).rejects.toThrow(
        NotFoundException
      )
      roles.findOne.mockResolvedValue(null)
      await expect(service.getRole(new ObjectId().toString())).rejects.toThrow(
        NotFoundException
      )
    })

    it('getRole and listRoles hide embedded permissions and project them out of the read', async () => {
      const r = role({ permissions: [embedded('read', 'User')] })
      roles.findOne.mockResolvedValue(r)
      // DB chiếu theo `select`: mô phỏng đúng hành vi đó (không có permissions).
      const projected = Object.fromEntries(
        Object.entries(r).filter(([key]) => key !== 'permissions')
      )
      roles.find.mockResolvedValue([projected])

      const one = await service.getRole(r._id.toString())
      const all = await service.listRoles()

      expect(one).not.toHaveProperty('permissions')
      expect(all[0]).not.toHaveProperty('permissions')
      expect(all[0]?.name).toBe('custom')
      const [findArgs] = roles.find.mock.calls[0] as [{ select: string[] }]
      expect(findArgs.select).not.toContain('permissions')
      expect(findArgs.select).toEqual(
        expect.arrayContaining(['_id', 'name', 'isSystem'])
      )
      const [findOneArgs] = roles.findOne.mock.calls[0] as [
        { select: string[] },
      ]
      expect(findOneArgs.select).not.toContain('permissions')
    })

    it('refuses to rename or delete a system role', async () => {
      const sys = role({ name: 'admin', isSystem: true })
      roles.findOne.mockResolvedValue(sys)
      const id = sys._id.toString()

      await expect(service.updateRole(id, { name: 'root' })).rejects.toThrow(
        BadRequestException
      )
      await expect(service.deleteRole(id)).rejects.toThrow(BadRequestException)
      expect(roles.delete).not.toHaveBeenCalled()
      expect(roles.updateOne).not.toHaveBeenCalled()
    })

    it('deletes a custom role (its permissions go with the document)', async () => {
      const custom = role({ permissions: [embedded('read', 'User')] })
      roles.findOne.mockResolvedValue(custom)

      await expect(service.deleteRole(custom._id.toString())).resolves.toEqual({
        deleted: true,
      })
      expect(roles.delete).toHaveBeenCalledWith(custom._id)
    })

    it('updateRole writes only scalar fields with updateOne and never overwrites permissions', async () => {
      const custom = role({ permissions: [embedded('read', 'User')] })
      roles.findOne.mockResolvedValue(custom)

      const result = await service.updateRole(custom._id.toString(), {
        description: 'mới',
        isActive: false,
      })

      expect(roles.save).not.toHaveBeenCalled()
      expect(roles.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update] = roles.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ]
      expect(filter).toEqual({ _id: custom._id })
      expect(update.$set).toEqual(
        expect.objectContaining({ description: 'mới', isActive: false })
      )
      expect(update.$set).not.toHaveProperty('permissions')
      expect(result).toMatchObject({ name: 'custom', description: 'mới' })
      expect(result).not.toHaveProperty('permissions')
    })

    it('updateRole renames a custom role after checking name availability', async () => {
      const custom = role()
      roles.findOne.mockResolvedValue(custom)
      roles.countBy.mockResolvedValue(1)

      await expect(
        service.updateRole(custom._id.toString(), { name: 'taken' })
      ).rejects.toThrow(ConflictException)
      expect(roles.updateOne).not.toHaveBeenCalled()
    })
  })

  describe('getPermissions', () => {
    it('returns the embedded permissions in the legacy shape with roleId', async () => {
      const first = embedded('read', 'User')
      const second = embedded('manage', 'Booking', false)
      const r = role({ permissions: [first, second] })
      roles.findOne.mockResolvedValue(r)
      const id = r._id.toString()

      const result = await service.getPermissions(id)

      expect(result).toEqual([
        {
          _id: first._id,
          roleId: id,
          action: 'read',
          subject: 'User',
          allowed: true,
          createdAt: first.createdAt,
          updatedAt: first.updatedAt,
        },
        {
          _id: second._id,
          roleId: id,
          action: 'manage',
          subject: 'Booking',
          allowed: false,
          createdAt: second.createdAt,
          updatedAt: second.updatedAt,
        },
      ])
    })

    it('returns [] for a role without permissions and NotFound for a missing role', async () => {
      const r = role({ permissions: undefined as unknown as RolePermission[] })
      roles.findOne.mockResolvedValue(r)
      await expect(service.getPermissions(r._id.toString())).resolves.toEqual(
        []
      )

      roles.findOne.mockResolvedValue(null)
      await expect(
        service.getPermissions(new ObjectId().toString())
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('setPermissions', () => {
    it('rejects unknown action or subject', async () => {
      const r = role()
      roles.findOne.mockResolvedValue(r)
      const id = r._id.toString()

      await expect(
        service.setPermissions(id, [
          { action: 'fly' as never, subject: 'all', allowed: true },
        ])
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.setPermissions(id, [
          { action: 'read', subject: 'Nope' as never, allowed: true },
        ])
      ).rejects.toThrow(BadRequestException)
      expect(roles.updateOne).not.toHaveBeenCalled()
    })

    it('replaces permissions with one atomic $set and de-duplicates action+subject', async () => {
      const r = role()
      roles.findOne.mockResolvedValue(r)
      const id = r._id.toString()

      const result = await service.setPermissions(id, [
        { action: 'read', subject: 'User', allowed: true },
        { action: 'read', subject: 'User', allowed: false },
        { action: 'manage', subject: 'Booking', allowed: true },
      ])

      expect(roles.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update] = roles.updateOne.mock.calls[0] as [
        Record<string, unknown>,
        { $set: { permissions: RolePermission[] } },
      ]
      expect(filter).toEqual({ _id: r._id })
      expect(update.$set.permissions).toHaveLength(2)
      expect(update.$set.permissions[0]).toMatchObject({
        action: 'read',
        subject: 'User',
        allowed: false,
      })
      expect(
        result.map(p => [p.action, p.subject, p.allowed, p.roleId])
      ).toEqual([
        ['read', 'User', false, id],
        ['manage', 'Booking', true, id],
      ])
    })

    it('keeps _id and createdAt of a permission that is kept', async () => {
      const kept = embedded('read', 'User', true)
      const r = role({ permissions: [kept] })
      roles.findOne.mockResolvedValue(r)

      const result = await service.setPermissions(r._id.toString(), [
        { action: 'read', subject: 'User', allowed: false },
      ])

      expect(result[0]?._id.equals(kept._id)).toBe(true)
      expect(result[0]?.createdAt).toEqual(kept.createdAt)
      expect(result[0]?.allowed).toBe(false)
      expect(result[0]?.updatedAt.getTime()).toBeGreaterThan(
        kept.updatedAt.getTime()
      )
    })

    it('clears all permissions when given an empty list', async () => {
      const r = role({ permissions: [embedded('read', 'User')] })
      roles.findOne.mockResolvedValue(r)

      await expect(
        service.setPermissions(r._id.toString(), [])
      ).resolves.toEqual([])
      const [, update] = roles.updateOne.mock.calls[0] as [
        unknown,
        { $set: { permissions: RolePermission[] } },
      ]
      expect(update.$set.permissions).toEqual([])
    })

    it('caps the stored list at actions x subjects even with duplicated input', async () => {
      const r = role()
      roles.findOne.mockResolvedValue(r)
      const all = RBAC_ACTIONS.flatMap(action =>
        RBAC_SUBJECTS.map(subject => ({ action, subject, allowed: true }))
      )

      await service.setPermissions(r._id.toString(), [...all, ...all])

      const [, update] = roles.updateOne.mock.calls[0] as [
        unknown,
        { $set: { permissions: RolePermission[] } },
      ]
      expect(update.$set.permissions).toHaveLength(MAX_ROLE_PERMISSIONS)
      expect(MAX_ROLE_PERMISSIONS).toBe(
        RBAC_ACTIONS.length * RBAC_SUBJECTS.length
      )
    })

    it('throws NotFound when the role disappears before the write', async () => {
      const r = role()
      roles.findOne.mockResolvedValue(r)
      roles.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })

      await expect(
        service.setPermissions(r._id.toString(), [
          { action: 'read', subject: 'User', allowed: true },
        ])
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('effective permissions by role', () => {
    const withRoles = (...list: Role[]): void => {
      roles.find.mockResolvedValue(list)
    }

    it('allows everything when the role has no matching entry (legacy behaviour)', async () => {
      withRoles(role({ name: 'staff', permissions: [] }))
      await expect(
        service.roleCan(['staff'], 'update', 'Apartment')
      ).resolves.toBe(true)
    })

    it('blocks what the admin switched off, and nothing else', async () => {
      withRoles(
        role({
          name: 'staff',
          permissions: [embedded('approve', 'Kyc', false)],
        })
      )
      await expect(service.roleCan(['staff'], 'approve', 'Kyc')).resolves.toBe(
        false
      )
      await expect(service.roleCan(['staff'], 'read', 'Kyc')).resolves.toBe(
        true
      )
    })

    it('keeps each role independent: tenant, landlord and staff have their own switches', async () => {
      withRoles(
        role({
          name: 'tenant',
          permissions: [embedded('create', 'Booking', false)],
        }),
        role({
          name: 'landlord',
          permissions: [embedded('create', 'Apartment', false)],
        }),
        role({ name: 'staff', permissions: [] })
      )
      await expect(
        service.roleCan(['tenant'], 'create', 'Booking')
      ).resolves.toBe(false)
      await expect(
        service.roleCan(['landlord'], 'create', 'Booking')
      ).resolves.toBe(true)
      await expect(
        service.roleCan(['landlord'], 'create', 'Apartment')
      ).resolves.toBe(false)
      await expect(
        service.roleCan(['staff'], 'create', 'Apartment')
      ).resolves.toBe(true)
    })

    it('a user holding several roles is allowed when any of them allows', async () => {
      withRoles(
        role({
          name: 'tenant',
          permissions: [embedded('create', 'Booking', false)],
        }),
        role({ name: 'landlord', permissions: [] })
      )
      await expect(
        service.roleCan(['tenant', 'landlord'], 'create', 'Booking')
      ).resolves.toBe(true)
    })

    it('roles the matrix does not manage are not restricted', async () => {
      withRoles(
        role({ name: 'staff', permissions: [embedded('read', 'Kyc', false)] })
      )
      await expect(
        service.roleCan(['somebody-else'], 'read', 'Kyc')
      ).resolves.toBe(true)
      await expect(service.roleCan([], 'read', 'Kyc')).resolves.toBe(true)
    })

    it('matches role names case-insensitively', async () => {
      withRoles(
        role({ name: 'staff', permissions: [embedded('read', 'Kyc', false)] })
      )
      await expect(service.roleCan(['STAFF'], 'read', 'Kyc')).resolves.toBe(
        false
      )
    })

    it('reads the database once within the cache window, for all managed roles', async () => {
      withRoles(role({ name: 'staff', permissions: [] }))
      await service.roleCan(['staff'], 'read', 'Kyc')
      await service.roleCan(['tenant'], 'read', 'Apartment')
      expect(roles.find).toHaveBeenCalledTimes(1)
    })

    it('applies a saved change immediately on this instance (cache dropped)', async () => {
      const staff = role({ name: 'staff', permissions: [] })
      withRoles(staff)
      roles.findOne.mockResolvedValue(staff)
      await expect(
        service.roleCan(['staff'], 'delete', 'CommunityPost')
      ).resolves.toBe(true)
      await service.setPermissions(staff._id.toString(), [
        { action: 'delete', subject: 'CommunityPost', allowed: false },
      ])
      withRoles(
        role({
          name: 'staff',
          permissions: [embedded('delete', 'CommunityPost', false)],
        })
      )
      await expect(
        service.roleCan(['staff'], 'delete', 'CommunityPost')
      ).resolves.toBe(false)
    })

    it('keeps serving the last known policy when the database fails', async () => {
      withRoles(
        role({
          name: 'staff',
          permissions: [embedded('approve', 'Kyc', false)],
        })
      )
      await service.roleCan(['staff'], 'read', 'Kyc')
      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 60_000)
      roles.find.mockRejectedValue(new Error('db down'))
      await expect(service.roleCan(['staff'], 'approve', 'Kyc')).resolves.toBe(
        false
      )
      jest.useRealTimers()
    })

    it('effectivePermissions: admin gets everything, others see what is switched off', async () => {
      withRoles(
        role({
          name: 'staff',
          permissions: [embedded('approve', 'Kyc', false)],
        })
      )
      const admin = await service.effectivePermissions(['admin'], true)
      const staff = await service.effectivePermissions(['staff'], false)
      expect(Object.values(admin).every(Boolean)).toBe(true)
      expect(staff['approve:Kyc']).toBe(false)
      expect(staff['read:Kyc']).toBe(true)
      expect(staff['read:CommunityPost']).toBe(true)
      expect(Object.keys(staff).some(k => k.endsWith(':all'))).toBe(false)
    })
  })

  describe('custom roles', () => {
    const staffBase = (): Role =>
      role({
        name: 'staff',
        isSystem: true,
        permissions: [embedded('approve', 'Kyc', false)],
      })

    it('creates a custom role by copying the base role permissions', async () => {
      roles.findOne.mockResolvedValue(staffBase())
      roles.countBy.mockResolvedValue(0)

      const out = await service.createRole({
        name: 'kyc-reviewer',
        label: 'Nhân viên KYC',
        baseRole: 'staff',
      })

      const [created] = roles.create.mock.calls[0] as [
        Partial<Role> & { permissions: RolePermission[] },
      ]
      expect(created).toMatchObject({
        name: 'kyc-reviewer',
        label: 'Nhân viên KYC',
        baseRole: 'staff',
        isSystem: false,
        isActive: true,
      })
      expect(created.permissions).toHaveLength(1)
      expect(created.permissions[0]).toMatchObject({
        action: 'approve',
        subject: 'Kyc',
        allowed: false,
      })
      expect(out.name).toBe('kyc-reviewer')
      expect(out).not.toHaveProperty('permissions')
    })

    it.each(['Admin', 'ab', 'staff', 'admin', '9abc', 'has space', 'me'])(
      'rejects the role code %s',
      async name => {
        await expect(
          service.createRole({ name, baseRole: 'staff' })
        ).rejects.toThrow(BadRequestException)
      }
    )

    it('rejects a duplicate code', async () => {
      roles.countBy.mockResolvedValue(1)
      await expect(
        service.createRole({ name: 'kyc-reviewer', baseRole: 'staff' })
      ).rejects.toThrow(ConflictException)
    })

    it('keeps the plain role creation unchanged when there is no base role', async () => {
      roles.countBy.mockResolvedValue(0)
      await service.createRole({ name: 'Auditor' })
      expect(roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Auditor', permissions: [] })
      )
    })

    it('does not allow renaming a custom role (users reference its code)', async () => {
      const custom = role({ name: 'kyc-reviewer', baseRole: 'staff' })
      roles.findOne.mockResolvedValue(custom)
      await expect(
        service.updateRole(custom._id.toString(), { name: 'other-name' })
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.updateRole(custom._id.toString(), { label: 'Tên mới' })
      ).resolves.toMatchObject({ label: 'Tên mới' })
    })

    it('deleting a custom role sends its users back to the base role permissions', async () => {
      const custom = role({ name: 'kyc-reviewer', baseRole: 'staff' })
      roles.findOne.mockResolvedValue(custom)
      await service.deleteRole(custom._id.toString())
      expect(users.updateMany).toHaveBeenCalledWith(
        { permissionProfile: 'kyc-reviewer' },
        { $set: { permissionProfile: null } }
      )
    })

    it('assigns users, un-assigns the rest, and requires the matching base role', async () => {
      const custom = role({ name: 'kyc-reviewer', baseRole: 'staff' })
      roles.findOne.mockResolvedValue(custom)
      const a = new ObjectId()
      users.countBy.mockResolvedValue(1)
      users.updateMany
        .mockResolvedValueOnce({ modifiedCount: 2 })
        .mockResolvedValueOnce({ modifiedCount: 1 })

      const out = await service.setRoleUsers(custom._id.toString(), [
        a.toString(),
        a.toString(),
      ])

      expect(users.countBy).toHaveBeenCalledWith({
        _id: { $in: [a] },
        role: 'staff',
      })
      expect(users.updateMany).toHaveBeenNthCalledWith(
        1,
        { permissionProfile: 'kyc-reviewer', _id: { $nin: [a] } },
        { $set: { permissionProfile: null } }
      )
      expect(users.updateMany).toHaveBeenNthCalledWith(
        2,
        { _id: { $in: [a] } },
        { $set: { permissionProfile: 'kyc-reviewer' } }
      )
      expect(out).toEqual({ assigned: 1, removed: 2 })
    })

    it('rejects users whose base role does not match, bad ids, and non-custom roles', async () => {
      const custom = role({ name: 'kyc-reviewer', baseRole: 'staff' })
      roles.findOne.mockResolvedValue(custom)
      users.countBy.mockResolvedValue(0)
      await expect(
        service.setRoleUsers(custom._id.toString(), [new ObjectId().toString()])
      ).rejects.toThrow(BadRequestException)
      await expect(
        service.setRoleUsers(custom._id.toString(), ['not-an-id'])
      ).rejects.toThrow(BadRequestException)
      expect(users.updateMany).not.toHaveBeenCalled()

      roles.findOne.mockResolvedValue(role({ name: 'staff', isSystem: true }))
      await expect(
        service.setRoleUsers(new ObjectId().toString(), [])
      ).rejects.toThrow(BadRequestException)
    })

    it('clearing the list un-assigns everyone without a write for assignment', async () => {
      const custom = role({ name: 'kyc-reviewer', baseRole: 'staff' })
      roles.findOne.mockResolvedValue(custom)
      users.updateMany.mockResolvedValue({ modifiedCount: 3 })
      const out = await service.setRoleUsers(custom._id.toString(), [])
      expect(users.updateMany).toHaveBeenCalledTimes(1)
      expect(out).toEqual({ assigned: 0, removed: 3 })
    })

    describe('permissions of a user holding a custom role', () => {
      const UID1 = new ObjectId().toString()
      const UID2 = new ObjectId().toString()
      const UID3 = new ObjectId().toString()
      const UID4 = new ObjectId().toString()
      const UID5 = new ObjectId().toString()

      const setup = (profile: string | null): void => {
        build(profile)
        roles.find.mockResolvedValue([
          role({
            name: 'staff',
            isSystem: true,
            permissions: [embedded('approve', 'Kyc', true)],
          }),
          role({
            name: 'kyc-reviewer',
            baseRole: 'staff',
            permissions: [embedded('approve', 'Apartment', false)],
          }),
        ])
      }

      it('uses the custom role table instead of the base role', async () => {
        setup('kyc-reviewer')
        await expect(
          service.roleCan(['staff'], 'approve', 'Apartment', UID1)
        ).resolves.toBe(false)
        await expect(
          service.roleCan(['staff'], 'read', 'Apartment', UID1)
        ).resolves.toBe(true)
      })

      it('uses the base role table for a user without a custom role', async () => {
        setup(null)
        await expect(
          service.roleCan(['staff'], 'approve', 'Apartment', UID2)
        ).resolves.toBe(true)
      })

      it('ignores a custom role whose base role does not match the user, or that is switched off', async () => {
        setup('kyc-reviewer')
        await expect(
          service.roleCan(['tenant'], 'approve', 'Apartment', UID3)
        ).resolves.toBe(true)

        build('kyc-reviewer')
        roles.find.mockResolvedValue([
          role({ name: 'staff', isSystem: true, permissions: [] }),
          role({
            name: 'kyc-reviewer',
            baseRole: 'staff',
            isActive: false,
            permissions: [embedded('approve', 'Apartment', false)],
          }),
        ])
        await expect(
          service.roleCan(['staff'], 'approve', 'Apartment', UID4)
        ).resolves.toBe(true)
      })

      it('does not look the profile up when there is no user id', async () => {
        setup('kyc-reviewer')
        await service.roleCan(['staff'], 'read', 'Kyc')
        expect(users.aggregate).not.toHaveBeenCalled()
      })

      it('caches the profile per user within the window', async () => {
        setup('kyc-reviewer')
        const id = UID5
        await service.roleCan(['staff'], 'read', 'Kyc', id)
        await service.roleCan(['staff'], 'read', 'Apartment', id)
        expect(users.aggregate).toHaveBeenCalledTimes(1)
      })
    })
  })
})
