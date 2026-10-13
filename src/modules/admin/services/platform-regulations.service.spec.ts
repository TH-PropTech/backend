import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { PlatformRegulationsService } from './platform-regulations.service'
import type { LegalSource } from '../../legal/schemas/legal-source.schema'
import type { PlatformRegulation } from '../../legal/schemas/platform-regulation.schema'
import type { CreatePlatformRegulationDto } from '../../legal/dto/platform-regulation.dto'

function mockRepo(): Record<string, jest.Mock> {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    // Như Mongo: gán _id khi insert bản ghi mới
    save: jest.fn((entity: { _id?: ObjectId }) =>
      Promise.resolve({ _id: new ObjectId(), ...entity })
    ),
    create: jest.fn((entity: unknown) => entity),
    update: jest.fn(),
    delete: jest.fn(),
  }
}

const DTO: CreatePlatformRegulationDto = {
  code: 'REG-NEW-01',
  title: 'Quy định mới',
  summary: 'Tóm tắt',
  category: 'residence',
  severity: 'mandatory',
  scope: ['all'],
  linkedSourceKey: '1.004194',
  checklistItems: [{ id: 'c1', label: 'Việc cần làm' }],
}

function regulation(
  overrides: Partial<PlatformRegulation> = {}
): PlatformRegulation {
  return {
    ...DTO,
    _id: new ObjectId(),
    code: 'REG-RES-01',
    linkedSourceKey: '1.004194',
    order: 1,
    isActive: true,
    isDefault: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('PlatformRegulationsService', () => {
  let regulations: Record<string, jest.Mock>
  let sources: Record<string, jest.Mock>
  let service: PlatformRegulationsService

  beforeEach(() => {
    regulations = mockRepo()
    sources = mockRepo()
    service = new PlatformRegulationsService(
      regulations as unknown as Repository<PlatformRegulation>,
      sources as unknown as Repository<LegalSource>
    )
  })

  describe('create', () => {
    it('creates regulation linked to an existing source', async () => {
      regulations.count!.mockResolvedValueOnce(0).mockResolvedValueOnce(5)
      sources.count!.mockResolvedValue(1)

      const result = await service.create(DTO, 'admin-1')

      expect(result).toMatchObject({
        code: 'REG-NEW-01',
        linkedSourceKey: '1.004194',
        order: 6,
        isDefault: false,
        updatedBy: 'admin-1',
      })
    })

    it('allows regulation without linked source', async () => {
      regulations.count!.mockResolvedValue(0)

      const result = await service.create(
        { ...DTO, linkedSourceKey: null },
        'admin-1'
      )

      expect(result.linkedSourceKey).toBeNull()
      expect(sources.count).not.toHaveBeenCalled()
    })

    it('rejects unknown linked source with LINKED_SOURCE_NOT_FOUND', async () => {
      regulations.count!.mockResolvedValue(0)
      sources.count!.mockResolvedValue(0)

      const error = await service
        .create({ ...DTO, linkedSourceKey: 'ghost' }, 'admin-1')
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'LINKED_SOURCE_NOT_FOUND',
      })
      expect(regulations.save).not.toHaveBeenCalled()
    })

    it('rejects duplicate code with 409', async () => {
      regulations.count!.mockResolvedValue(1)

      await expect(service.create(DTO, 'admin-1')).rejects.toThrow(
        ConflictException
      )
    })
  })

  describe('update', () => {
    it('updates fields without touching the original entity', async () => {
      const existing = regulation()
      regulations.findOne!.mockResolvedValue(existing)

      const result = await service.update(
        existing._id.toString(),
        { isActive: false },
        'admin-2'
      )

      expect(result).toMatchObject({ isActive: false, updatedBy: 'admin-2' })
      expect(existing.isActive).toBe(true)
    })

    it('checks code uniqueness only when code changes', async () => {
      const existing = regulation()
      regulations.findOne!.mockResolvedValue(existing)
      regulations.count!.mockResolvedValue(1)
      sources.count!.mockResolvedValue(1)

      await expect(
        service.update(existing._id.toString(), { code: 'REG-TAX-02' }, 'a')
      ).rejects.toThrow(ConflictException)
      await expect(
        service.update(existing._id.toString(), { code: 'REG-RES-01' }, 'a')
      ).resolves.toBeDefined()
    })

    it('throws 404 for invalid or unknown id', async () => {
      await expect(service.update('not-an-id', {}, 'a')).rejects.toThrow(
        NotFoundException
      )
      regulations.findOne!.mockResolvedValue(null)
      await expect(
        service.update(new ObjectId().toString(), {}, 'a')
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('deletes by object id', async () => {
      const existing = regulation()
      regulations.findOne!.mockResolvedValue(existing)

      await service.remove(existing._id.toString())

      expect(regulations.delete).toHaveBeenCalledWith(existing._id)
    })
  })

  describe('reorder', () => {
    it('assigns order by list position and rejects non-permutations', async () => {
      const a = regulation()
      const b = regulation({ code: 'REG-TAX-02' })
      regulations.find!.mockResolvedValue([a, b])

      await service.reorder([b._id.toString(), a._id.toString()], 'admin-1')
      expect(regulations.update).toHaveBeenCalledWith(b._id, {
        order: 1,
        updatedBy: 'admin-1',
      })

      await expect(
        service.reorder([a._id.toString()], 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })
  })
})
