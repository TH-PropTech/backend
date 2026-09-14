import type { Repository } from 'typeorm'
import { NotFoundException } from '@nestjs/common'
import { RentalFlowAssignmentsService } from './rental-flow-assignments.service'
import { SAFE_DEFAULT_FLOW_PROFILE_ID } from './default-flow-profile'
import type { RentalFlowAssignment } from './schemas/rental-flow-assignment.schema'
import type { RentalFlowProfile } from './schemas/rental-flow-profile.schema'
import type { RentalFlowAudit } from './schemas/rental-flow-audit.schema'

interface MockAssignmentRepo {
  findOne: jest.Mock
  find: jest.Mock
  create: jest.Mock
  save: jest.Mock
}

interface MockProfileRepo {
  findOne: jest.Mock
}

interface MockAuditRepo {
  create: jest.Mock
  save: jest.Mock
}

describe('RentalFlowAssignmentsService', () => {
  let service: RentalFlowAssignmentsService
  let mockAssignmentRepo: MockAssignmentRepo
  let mockProfileRepo: MockProfileRepo
  let mockAuditRepo: MockAuditRepo

  beforeEach(() => {
    mockAssignmentRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve({ _id: 'asgn-mongo-id', ...entity })
      ),
    }

    mockProfileRepo = {
      findOne: jest.fn(),
    }

    mockAuditRepo = {
      create: jest.fn((dto: Record<string, unknown>) => ({ ...dto })),
      save: jest.fn((entity: Record<string, unknown>) =>
        Promise.resolve(entity)
      ),
    }

    service = new RentalFlowAssignmentsService(
      mockAssignmentRepo as unknown as Repository<RentalFlowAssignment>,
      mockProfileRepo as unknown as Repository<RentalFlowProfile>,
      mockAuditRepo as unknown as Repository<RentalFlowAudit>
    )
  })

  it('ensures active global seed assignment exists on module init (Happy path)', async () => {
    mockAssignmentRepo.findOne.mockResolvedValue(null)
    mockProfileRepo.findOne.mockResolvedValue({
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
      version: 1,
      contentHash: 'hash-v1',
    })

    const seeded = await service.ensureGlobalSeedAssignment()

    expect(mockAssignmentRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'GLOBAL',
        profileRef: {
          profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
          version: 1,
          contentHash: 'hash-v1',
        },
      })
    )
    expect(seeded).toBeDefined()
  })

  it('throws NotFoundException when activating assignment for non-existent profile', async () => {
    mockProfileRepo.findOne.mockResolvedValue(null)

    await expect(
      service.activateAssignment(
        {
          scope: 'DURATION',
          scopeValue: '12',
          profileId: 'prof-ghost',
          version: 1,
        },
        'admin-1'
      )
    ).rejects.toThrow(NotFoundException)
  })

  it('supersedes previous active assignment of identical scope when activating new one', async () => {
    const existingActive = {
      assignmentId: 'asgn-old-1',
      scope: 'DURATION',
      scopeValue: '12',
      supersededAt: null,
      profileRef: {
        profileId: 'prof-old',
        version: 1,
        contentHash: 'hash-old',
      },
    }

    mockProfileRepo.findOne.mockResolvedValue({
      profileId: 'prof-vip',
      version: 2,
      contentHash: 'hash-v2',
    })
    mockAssignmentRepo.find.mockResolvedValue([existingActive])

    const activated = await service.activateAssignment(
      {
        scope: 'DURATION',
        scopeValue: '12',
        profileId: 'prof-vip',
        version: 2,
      },
      'admin-1'
    )

    expect(existingActive.supersededAt).toBeInstanceOf(Date)
    expect(mockAssignmentRepo.save).toHaveBeenCalledWith(existingActive)
    expect(mockAuditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ASSIGNMENT_SUPERSEDED',
      })
    )
    expect(activated.scope).toBe('DURATION')
  })
})
