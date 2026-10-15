import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as crypto from 'crypto'
import { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import {
  asAssignmentRow,
  toAssignmentView,
  type RentalFlowAssignmentView,
} from '../utils/rental-flow-config.mapper'
import {
  toRentalFlowAuditView,
  type RentalFlowAuditView,
} from '../utils/rental-flow-audit.mapper'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import { SAFE_DEFAULT_FLOW_PROFILE_ID } from '../utils/default-flow-profile'
import type { ActivateFlowAssignmentDto } from '../dto/activate-flow-assignment.dto'

@Injectable()
export class RentalFlowAssignmentsService implements OnModuleInit {
  private readonly logger = new Logger(RentalFlowAssignmentsService.name)

  constructor(
    @InjectRepository(RentalFlowConfig)
    private readonly configRepo: Repository<RentalFlowConfig>,
    private readonly configAudit: ConfigAuditService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureGlobalSeedAssignment()
  }

  async ensureGlobalSeedAssignment(): Promise<RentalFlowAssignmentView> {
    // Mongo: `null` thay IsNull() (FindOperator bị BSON tuần tự hóa sai). FindOptionsWhere không khai báo null nên ép kiểu hẹp.
    const existing = await this.configRepo.findOne({
      where: {
        kind: 'assignment',
        scope: 'GLOBAL',
        supersededAt: null as unknown as Date,
      },
    })

    if (existing) {
      return toAssignmentView(existing)
    }

    const defaultProfile = await this.configRepo.findOne({
      where: {
        kind: 'profile',
        key: SAFE_DEFAULT_FLOW_PROFILE_ID,
        status: 'published',
        version: 1,
      },
    })

    const profileRef = {
      profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
      version: 1,
      contentHash: defaultProfile?.contentHash || 'default-seed-hash',
    }

    const seedAssignment = this.configRepo.create({
      kind: 'assignment',
      key: `asgn-global-seed`,
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
    return toAssignmentView(await this.configRepo.save(seedAssignment))
  }

  async listAssignments(): Promise<RentalFlowAssignmentView[]> {
    const rows = await this.configRepo.find({
      where: { kind: 'assignment' },
      order: { createdAt: 'DESC' },
    })
    return rows.map(toAssignmentView)
  }

  async activateAssignment(
    dto: ActivateFlowAssignmentDto,
    actorId: string
  ): Promise<RentalFlowAssignmentView> {
    const publishedProfile = await this.configRepo.findOne({
      where: {
        kind: 'profile',
        key: dto.profileId,
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
    const activePrevious = await this.configRepo.find({
      where: {
        kind: 'assignment',
        scope: dto.scope,
        scopeValue: dto.scopeValue
          ? dto.scopeValue
          : (null as unknown as string),
        supersededAt: null as unknown as Date,
      },
    })

    for (const prevRow of activePrevious) {
      const prev = asAssignmentRow(prevRow)
      prev.supersededAt = now
      await this.configRepo.save(prev)

      await this.configAudit.append({
        scope: 'rental-flow',
        action: 'ASSIGNMENT_SUPERSEDED',
        actorId,
        targetType: 'assignment',
        key: prev.key,
        version: prev.profileRef?.version ?? null,
        details: {
          scope: prev.scope,
          scopeValue: prev.scopeValue,
          supersededByProfile: dto.profileId,
          supersededByVersion: dto.version,
        },
      })
    }

    const newAssignment = this.configRepo.create({
      kind: 'assignment',
      key: `asgn-${crypto.randomUUID().slice(0, 8)}`,
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

    const saved = await this.configRepo.save(newAssignment)
    const savedView = toAssignmentView(saved)

    await this.configAudit.append({
      scope: 'rental-flow',
      action: 'ASSIGNMENT_ACTIVATED',
      actorId,
      targetType: 'assignment',
      key: savedView.assignmentId,
      version: dto.version,
      details: {
        scope: savedView.scope,
        scopeValue: savedView.scopeValue,
        profileId: dto.profileId,
        effectiveAt: savedView.effectiveAt,
      },
    })

    this.logger.log(
      `Assignment [${savedView.assignmentId}] activated for scope [${savedView.scope}:${savedView.scopeValue || '*'}] -> profile [${dto.profileId} v${dto.version}]`
    )

    return savedView
  }

  async getAudits(): Promise<RentalFlowAuditView[]> {
    const rows = await this.configAudit.findRecent('rental-flow', 100)
    return rows.map(toRentalFlowAuditView)
  }
}
