import { BadRequestException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { PoliciesService } from './policies.service'
import { Policy } from '../schemas/policy.schema'

describe('PoliciesService', () => {
  let service: PoliciesService
  let repository: jest.Mocked<Repository<Policy>>

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<Policy>>

    service = new PoliciesService(repository)
  })

  describe('findPublicPolicies', () => {
    it('returns only active public policies in clean projection', async () => {
      const mockPolicies = [
        {
          key: 'PLATFORM_FEE_PERCENT',
          value: '1',
          description: 'Phí sàn',
          unit: '%',
          status: 'active',
          updatedBy: 'admin',
        },
      ] as Policy[]

      repository.find.mockResolvedValue(mockPolicies)

      const result = await service.findPublicPolicies()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        key: 'PLATFORM_FEE_PERCENT',
        value: '1',
        description: 'Phí sàn',
        unit: '%',
      })
      expect(
        (result[0] as unknown as Record<string, unknown>).updatedBy
      ).toBeUndefined()
    })
  })

  describe('update', () => {
    it('updates policy with validated value', async () => {
      const mockPolicy = {
        key: 'PLATFORM_FEE_PERCENT',
        value: '1',
      } as Policy

      repository.findOne.mockResolvedValue(mockPolicy)
      repository.save.mockImplementation((p: unknown) =>
        Promise.resolve(p as Policy)
      )

      const updated = await service.update(
        'PLATFORM_FEE_PERCENT',
        '2',
        'admin-1'
      )
      expect(updated.value).toBe('2')
      expect(updated.updatedBy).toBe('admin-1')
    })

    it('rejects invalid value with BadRequestException', async () => {
      await expect(
        service.update('PLATFORM_FEE_PERCENT', '150', 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects non-numeric value for numeric policy', async () => {
      await expect(
        service.update('PLATFORM_FEE_PERCENT', 'invalid-number', 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects invalid boolean value for boolean policy', async () => {
      await expect(
        service.update('CONTRACT_MUST_BE_WRITTEN', 'maybe', 'admin-1')
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('updateStatus', () => {
    it('updates policy status and records actor', async () => {
      const mockPolicy = {
        key: 'PLATFORM_FEE_PERCENT',
        status: 'active',
      } as Policy

      repository.findOne.mockResolvedValue(mockPolicy)
      repository.save.mockImplementation((p: unknown) =>
        Promise.resolve(p as Policy)
      )

      const updated = await service.updateStatus(
        'PLATFORM_FEE_PERCENT',
        'inactive',
        'admin-2'
      )
      expect(updated.status).toBe('inactive')
      expect(updated.updatedBy).toBe('admin-2')
    })
  })
})
