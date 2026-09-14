import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, IsNull } from 'typeorm'
import {
  RentalFlowAssignment,
  type FlowAssignmentScope,
} from './schemas/rental-flow-assignment.schema'
import {
  RentalFlowProfile,
  type FlowProfileSteps,
} from './schemas/rental-flow-profile.schema'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from './default-flow-profile'

export interface ResolveConfigOptions {
  durationMonths?: number | null | undefined
  packageId?: string | null | undefined
}

export interface ResolvedFlowConfigResult {
  effectiveConfig: FlowProfileSteps
  resolvedFrom: {
    scope: FlowAssignmentScope | 'SYSTEM_FALLBACK'
    scopeValue: string | null
    profileId: string
    profileName: string
    version: number
    contentHash: string
    assignmentId: string | null
  }
}

@Injectable()
export class RentalFlowConfigResolver {
  private readonly logger = new Logger(RentalFlowConfigResolver.name)

  constructor(
    @InjectRepository(RentalFlowAssignment)
    private readonly assignmentRepo: Repository<RentalFlowAssignment>,
    @InjectRepository(RentalFlowProfile)
    private readonly profileRepo: Repository<RentalFlowProfile>
  ) {}

  async resolve(
    options: ResolveConfigOptions
  ): Promise<ResolvedFlowConfigResult> {
    const now = new Date()

    // 1. Kiểm tra PACKAGE assignment
    if (options.packageId) {
      const packageAssignment = await this.assignmentRepo.findOne({
        where: {
          scope: 'PACKAGE',
          scopeValue: options.packageId,
          supersededAt: IsNull(),
        },
      })

      if (packageAssignment && packageAssignment.effectiveAt <= now) {
        const resolved = await this.loadProfileByRef(
          packageAssignment.profileRef,
          'PACKAGE',
          packageAssignment.scopeValue,
          packageAssignment.assignmentId
        )
        if (resolved) return resolved
      }
    }

    // 2. Kiểm tra DURATION assignment
    if (options.durationMonths) {
      const durationAssignment = await this.assignmentRepo.findOne({
        where: {
          scope: 'DURATION',
          scopeValue: String(options.durationMonths),
          supersededAt: IsNull(),
        },
      })

      if (durationAssignment && durationAssignment.effectiveAt <= now) {
        const resolved = await this.loadProfileByRef(
          durationAssignment.profileRef,
          'DURATION',
          durationAssignment.scopeValue,
          durationAssignment.assignmentId
        )
        if (resolved) return resolved
      }
    }

    // 3. Kiểm tra GLOBAL assignment
    const globalAssignment = await this.assignmentRepo.findOne({
      where: {
        scope: 'GLOBAL',
        supersededAt: IsNull(),
      },
    })

    if (globalAssignment && globalAssignment.effectiveAt <= now) {
      const resolved = await this.loadProfileByRef(
        globalAssignment.profileRef,
        'GLOBAL',
        null,
        globalAssignment.assignmentId
      )
      if (resolved) return resolved
    }

    // 4. Safe System Fallback
    return {
      effectiveConfig: DEFAULT_FLOW_PROFILE_STEPS,
      resolvedFrom: {
        scope: 'SYSTEM_FALLBACK',
        scopeValue: null,
        profileId: SAFE_DEFAULT_FLOW_PROFILE_ID,
        profileName: 'Quy chuẩn Luồng thuê Mặc định (Nghị định 96/2024)',
        version: 1,
        contentHash: 'safe-system-fallback-hash',
        assignmentId: null,
      },
    }
  }

  private async loadProfileByRef(
    ref: { profileId: string; version: number; contentHash?: string },
    scope: FlowAssignmentScope,
    scopeValue: string | null,
    assignmentId: string
  ): Promise<ResolvedFlowConfigResult | null> {
    const profile = await this.profileRepo.findOne({
      where: {
        profileId: ref.profileId,
        status: 'published',
        version: ref.version,
      },
    })

    if (!profile) {
      this.logger.warn(
        `Assignment [${assignmentId}] references non-existent profile [${ref.profileId} v${ref.version}]. Falling back to lower precedence.`
      )
      return null
    }

    return {
      effectiveConfig: profile.steps,
      resolvedFrom: {
        scope,
        scopeValue,
        profileId: profile.profileId,
        profileName: profile.name,
        version: profile.version || ref.version,
        contentHash: profile.contentHash || ref.contentHash || '',
        assignmentId,
      },
    }
  }

  async resolveProfile(options: ResolveConfigOptions): Promise<{
    profileId: string
    name: string
    version: number
    hash: string
    precedence: string
    steps: FlowProfileSteps
  }> {
    const res = await this.resolve(options)
    return {
      profileId: res.resolvedFrom.profileId,
      name: res.resolvedFrom.profileName,
      version: res.resolvedFrom.version,
      hash: res.resolvedFrom.contentHash,
      precedence: res.resolvedFrom.scope,
      steps: res.effectiveConfig,
    }
  }
}
