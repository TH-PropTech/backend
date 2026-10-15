import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
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
  let service: RbacService

  beforeEach(() => {
    roles = mockRepo()
    service = new RbacService(roles as unknown as MongoRepository<Role>)
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
})
