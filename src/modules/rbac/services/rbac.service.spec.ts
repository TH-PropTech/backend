import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { DEFAULT_ROLES } from '../rbac.constants'
import type { Permission } from '../schemas/permission.schema'
import type { Role } from '../schemas/role.schema'
import { RbacService } from './rbac.service'

interface MockRepo {
  find: jest.Mock
  findOne: jest.Mock
  count: jest.Mock
  create: jest.Mock
  save: jest.Mock
  delete: jest.Mock
}

function mockRepo(): MockRepo {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((entity: unknown) => entity),
    save: jest.fn((entity: unknown) =>
      Promise.resolve(
        Array.isArray(entity)
          ? entity
          : { _id: new ObjectId(), ...(entity as object) }
      )
    ),
    delete: jest.fn(),
  }
}

function role(overrides: Partial<Role> = {}): Role {
  return {
    _id: new ObjectId(),
    name: 'custom',
    description: '',
    isActive: true,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('RbacService', () => {
  let roles: MockRepo
  let perms: MockRepo
  let service: RbacService

  beforeEach(() => {
    roles = mockRepo()
    perms = mockRepo()
    service = new RbacService(
      roles as unknown as Repository<Role>,
      perms as unknown as Repository<Permission>
    )
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
    it('creates every missing role with its permissions', async () => {
      roles.findOne.mockResolvedValue(null)

      const created = await service.seedDefaults()

      expect(created).toEqual(DEFAULT_ROLES.map(r => r.name))
      expect(roles.save).toHaveBeenCalledTimes(DEFAULT_ROLES.length)
      expect(roles.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'admin', isSystem: true })
      )
      expect(perms.save).toHaveBeenCalledTimes(DEFAULT_ROLES.length)
    })

    it('is idempotent: existing roles are left untouched', async () => {
      roles.findOne.mockResolvedValue(role({ name: 'admin' }))

      const created = await service.seedDefaults()

      expect(created).toEqual([])
      expect(roles.save).not.toHaveBeenCalled()
      expect(perms.save).not.toHaveBeenCalled()
    })

    it('onModuleInit swallows DB errors', async () => {
      roles.findOne.mockRejectedValue(new Error('mongo down'))
      await expect(service.onModuleInit()).resolves.toBeUndefined()
    })
  })

  describe('roles', () => {
    it('rejects a duplicate role name', async () => {
      roles.count.mockResolvedValue(1)
      await expect(service.createRole({ name: 'admin' })).rejects.toThrow(
        ConflictException
      )
    })

    it('creates a non-system role', async () => {
      await service.createRole({ name: 'auditor' })
      expect(roles.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'auditor', isSystem: false })
      )
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

    it('refuses to rename or delete a system role', async () => {
      const sys = role({ name: 'admin', isSystem: true })
      roles.findOne.mockResolvedValue(sys)
      const id = sys._id.toString()

      await expect(service.updateRole(id, { name: 'root' })).rejects.toThrow(
        BadRequestException
      )
      await expect(service.deleteRole(id)).rejects.toThrow(BadRequestException)
      expect(roles.delete).not.toHaveBeenCalled()
    })

    it('deletes a custom role together with its permissions', async () => {
      const custom = role()
      roles.findOne.mockResolvedValue(custom)

      await expect(service.deleteRole(custom._id.toString())).resolves.toEqual({
        deleted: true,
      })
      expect(perms.delete).toHaveBeenCalledWith({
        roleId: custom._id.toString(),
      })
      expect(roles.delete).toHaveBeenCalledWith(custom._id)
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
      expect(perms.delete).not.toHaveBeenCalled()
    })

    it('replaces permissions and de-duplicates action+subject', async () => {
      const r = role()
      roles.findOne.mockResolvedValue(r)
      const id = r._id.toString()

      await service.setPermissions(id, [
        { action: 'read', subject: 'User', allowed: true },
        { action: 'read', subject: 'User', allowed: false },
        { action: 'manage', subject: 'Booking', allowed: true },
      ])

      expect(perms.delete).toHaveBeenCalledWith({ roleId: id })
      expect(perms.save).toHaveBeenCalledWith([
        { action: 'read', subject: 'User', allowed: false, roleId: id },
        { action: 'manage', subject: 'Booking', allowed: true, roleId: id },
      ])
    })
  })
})
