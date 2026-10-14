import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, IsNull } from 'typeorm'
import * as crypto from 'crypto'
import { RentalFlowAssignment } from '../schemas/rental-flow-assignment.schema'
import { RentalFlowProfile } from '../schemas/rental-flow-profile.schema'
import { RentalFlowAudit } from '../schemas/rental-flow-audit.schema'
import { SAFE_DEFAULT_FLOW_PROFILE_ID } from '../utils/default-flow-profile'
import type { ActivateFlowAssignmentDto } from '../dto/activate-flow-assignment.dto'

@Injectable()
export class RentalFlowAssignmentsService implements OnModuleInit {
  private readonly logger = new Logger(RentalFlowAssignmentsService.name)

  constructor(
    @InjectRepository(RentalFlowAssignment)
    private readonly assignmentRepo: Repository<RentalFlowAssignment>,
    @InjectRepository(RentalFlowProfile)
    private readonly profileRepo: Repository<RentalFlowProfile>,
    @InjectRepository(RentalFlowAudit)
    private readonly auditRepo: Repository<RentalFlowAudit>
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureGlobalSeedAssignment()
  }

  async ensureGlobalSeedAssignment(): Promise<RentalFlowAssignment> {
    const existing = await this.assignmentRepo.findOne({
      where: {
        scope: 'GLOBAL',
        supersededAt: IsNull(),
      },
    })

    if (existing) {
      return existing
    }

    const defaultProfile = await this.profileRepo.findOne({
      where: {
        profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
        status: 'published',
        version: 1,
      },
    })

    const profileRef = {
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
      version: 1,
      contentHash: defaultProfile?.contentHash || 'default-seed-hash',
    }

    const seedAssignment = this.assignmentRepo.create({
      assignmentId: `asgn-global-seed`,
      scope: 'GLOBAL',
      scopeValue: null,
      profileRef,
      effectiveAt: new Date(),
      supersededAt: null,
      createdBy: 'system',
    })

    this.logger.log(
      'Seeding initial active GLOBAL assignment pointing to safe-default-profile v1...'
    )
    return this.assignmentRepo.save(seedAssignment)
  }

  async listAssignments(): Promise<RentalFlowAssignment[]> {
    return this.assignmentRepo.find({
      order: { createdAt: 'DESC' },
    })
  }

  async activateAssignment(
    dto: ActivateFlowAssignmentDto,
    actorId: string
  ): Promise<RentalFlowAssignment> {
    const publishedProfile = await this.profileRepo.findOne({
      where: {
        profileId: dto.profileId,
        status: 'published',
        version: dto.version,
      },
    })

    if (!publishedProfile) {
      throw new NotFoundException(
        `Không tìm thấy phiên bản xuất bản [v${dto.version}] của profile [${dto.profileId}]`
      )
    }

    const now = new Date()
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : now

    // Tìm và kết thúc assignment đang active trước đó có cùng scope & scopeValue
    const activePrevious = await this.assignmentRepo.find({
      where: {
        scope: dto.scope,
        scopeValue: dto.scopeValue ? dto.scopeValue : IsNull(),
        supersededAt: IsNull(),
      },
    })

    for (const prev of activePrevious) {
      prev.supersededAt = now
      await this.assignmentRepo.save(prev)

      await this.auditRepo.save(
        this.auditRepo.create({
          action: 'ASSIGNMENT_SUPERSEDED',
          actorId,
          targetType: 'assignment',
          targetId: prev.assignmentId,
          version: prev.profileRef?.version ?? null,
          details: {
            scope: prev.scope,
            scopeValue: prev.scopeValue,
            supersededByProfile: dto.profileId,
            supersededByVersion: dto.version,
          },
        })
      )
    }

    const newAssignment = this.assignmentRepo.create({
      assignmentId: `asgn-${crypto.randomUUID().slice(0, 8)}`,
      scope: dto.scope,
      scopeValue: dto.scopeValue ?? null,
      profileRef: {
        profileId: dto.profileId,
        version: dto.version,
        contentHash: publishedProfile.contentHash || '',
      },
      effectiveAt,
      supersededAt: null,
      createdBy: actorId,
    })

    const saved = await this.assignmentRepo.save(newAssignment)

    await this.auditRepo.save(
      this.auditRepo.create({
        action: 'ASSIGNMENT_ACTIVATED',
        actorId,
        targetType: 'assignment',
        targetId: saved.assignmentId,
        version: dto.version,
        details: {
          scope: saved.scope,
          scopeValue: saved.scopeValue,
          profileId: dto.profileId,
          effectiveAt: saved.effectiveAt,
        },
      })
    )

    this.logger.log(
      `Assignment [${saved.assignmentId}] activated for scope [${saved.scope}:${saved.scopeValue || '*'}] -> profile [${dto.profileId} v${dto.version}]`
    )

    return saved
  }

  async getAudits(): Promise<RentalFlowAudit[]> {
    return this.auditRepo.find({
      order: { createdAt: 'DESC' },
      take: 100,
    })
  }
}
