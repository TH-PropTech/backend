import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { RentalFlowProfilesService } from './rental-flow-profiles.service'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from '../utils/default-flow-profile'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'

interface MockProfileRepo {
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  save: jest.Mock
}

interface MockAuditRepo {
  create: jest.Mock
  save: jest.Mock
}

describe('RentalFlowProfilesService', () => {
  let service: RentalFlowProfilesService
  let mockProfileRepo: MockProfileRepo
  let mockAuditRepo: MockAuditRepo

  beforeEach(() => {
    mockProfileRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve({ _id: 'mongo-id', ...entity })
      ),
    }

    mockAuditRepo = {
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve(entity)
      ),
    }

    service = new RentalFlowProfilesService(
      mockProfileRepo as unknown as Repository<RentalFlowConfig>,
      new ConfigAuditService(
        mockAuditRepo as unknown as Repository<ActivityLog>
      )
    )
  })

  it('ensures seed profile v1 exists on module init (Happy path)', async () => {
    mockProfileRepo.findOne.mockResolvedValue(null) // Not existing yet

    const seeded = await service.ensureSeedProfile()

    expect(mockProfileRepo.create).toHaveBeenCalled()
    expect(mockProfileRepo.save).toHaveBeenCalled()
    expect(seeded.profileId).toBe(SAFE_DEFAULT_FLOW_PROFILE_ID)
    expect(seeded.version).toBe(1)
    expect(seeded.status).toBe('published')
  })

  it('returns existing seed profile if already present', async () => {
    const existing = {
      kind: 'profile',
      key: SAFE_DEFAULT_FLOW_PROFILE_ID,
      version: 1,
      status: 'published',
    }
    mockProfileRepo.findOne.mockResolvedValue(existing)

    const result = await service.ensureSeedProfile()
    expect(result).toEqual({
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
      version: 1,
      status: 'published',
    })
    expect(mockProfileRepo.save).not.toHaveBeenCalled()
  })

  it('saves draft successfully when expectedRevision matches (Optimistic concurrency)', async () => {
    const existingDraft = {
      kind: 'profile',
      key: 'custom-prof',
      draftRevision: 2,
      status: 'draft',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    }
    mockProfileRepo.findOne.mockResolvedValue(existingDraft)

    const updated = await service.saveDraft(
      'custom-prof',
      {
        name: 'Updated Name',
        changeClassification: 'PRESENTATION',
        steps: DEFAULT_FLOW_PROFILE_STEPS,
        expectedRevision: 2, // Matches current revision
      },
      'admin-1'
    )

    expect(mockProfileRepo.save).toHaveBeenCalled()
    expect(updated.draftRevision).toBe(3)
  })

  it('rejects saveDraft with ConflictException when expectedRevision is stale', async () => {
    const existingDraft = {
      kind: 'profile',
      key: 'custom-prof',
      draftRevision: 5,
      status: 'draft',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    }
    mockProfileRepo.findOne.mockResolvedValue(existingDraft)

    await expect(
      service.saveDraft(
        'custom-prof',
        {
          name: 'Stale Attempt',
          changeClassification: 'PRESENTATION',
          steps: DEFAULT_FLOW_PROFILE_STEPS,
          expectedRevision: 4, // Stale!
        },
        'admin-1'
      )
    ).rejects.toThrow(ConflictException)
  })

  it('publishes profile successfully, generates canonical SHA-256 hash, and increments immutable version', async () => {
    const existingDraft = {
      kind: 'profile',
      key: 'prof-99',
      name: 'Profile 99',
      version: 2,
      draftRevision: 4,
      status: 'draft',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    }
    mockProfileRepo.findOne.mockResolvedValueOnce(existingDraft)
    mockProfileRepo.findOne.mockResolvedValueOnce({
      ...existingDraft,
      version: 3,
      contentHash: 'hash-published',
      status: 'published',
    })

    const published = await service.publish(
      'prof-99',
      { expectedRevision: 4 },
      'admin-1'
    )

    expect(mockProfileRepo.save).toHaveBeenCalled()
    expect(mockAuditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'config-audit',
        action: 'PROFILE_PUBLISHED',
        actorId: 'admin-1',
        scope: 'rental-flow',
        targetType: 'profile',
        key: 'prof-99',
        version: 4,
      })
    )
    expect(published.version).toBe(4)
  })

  it('restores previous immutable version into active draft with incremented revision', async () => {
    const historicalV1 = {
      kind: 'profile',
      key: 'prof-archived',
      version: 1,
      status: 'published',
      name: 'V1 Name',
      steps: DEFAULT_FLOW_PROFILE_STEPS,
    }

    const currentDraft = {
      kind: 'profile',
      key: 'prof-archived',
      status: 'draft',
      draftRevision: 7,
    }

    // 1st findOne: find historical target version
    mockProfileRepo.findOne.mockResolvedValueOnce(historicalV1)
    // 2nd findOne: find current draft
    mockProfileRepo.findOne.mockResolvedValueOnce(currentDraft)

    const restored = await service.restoreVersion('prof-archived', 1, 'admin-1')

    expect(mockProfileRepo.save).toHaveBeenCalled()
    expect(restored.draftRevision).toBe(8)
    expect(restored.name).toBe('V1 Name')
  })

  it('throws NotFoundException when restoring non-existent version', async () => {
    mockProfileRepo.findOne.mockResolvedValueOnce(null)

    await expect(
      service.restoreVersion('prof-archived', 999, 'admin-1')
    ).rejects.toThrow(NotFoundException)
  })
})
