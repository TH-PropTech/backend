import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { FlowProfileSteps } from '../schemas/rental-flow-profile.schema'
import {
  RentalFlowConfig,
  type FlowAssignmentScope,
  type ProfileReference,
} from '../schemas/rental-flow-config.schema'
import {
  asAssignmentRow,
  asProfileRow,
} from '../utils/rental-flow-config.mapper'
import {
  DEFAULT_FLOW_PROFILE_STEPS,
  SAFE_DEFAULT_FLOW_PROFILE_ID,
} from '../utils/default-flow-profile'

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
    @InjectRepository(RentalFlowConfig)
    private readonly configRepo: Repository<RentalFlowConfig>
  ) {}

  async resolve(
    options: ResolveConfigOptions
  ): Promise<ResolvedFlowConfigResult> {
    const now = new Date()

    // Mongo: dùng `null` thay IsNull() (FindOperator bị BSON tuần tự hóa thành subdocument, không khớp null)
    // 1. Kiểm tra PACKAGE assignment
    if (options.packageId) {
      const packageRow = await this.configRepo.findOne({
        where: {
          kind: 'assignment',
          scope: 'PACKAGE',
          scopeValue: options.packageId,
          supersededAt: null as unknown as Date,
        },
      })

      if (packageRow) {
        const packageAssignment = asAssignmentRow(packageRow)
        if (packageAssignment.effectiveAt <= now) {
          const resolved = await this.loadProfileByRef(
            packageAssignment.profileRef,
            'PACKAGE',
            packageAssignment.scopeValue,
            packageAssignment.key
          )
          if (resolved) return resolved
        }
      }
    }

    // 2. Kiểm tra DURATION assignment
    if (options.durationMonths) {
      const durationRow = await this.configRepo.findOne({
        where: {
          kind: 'assignment',
          scope: 'DURATION',
          scopeValue: String(options.durationMonths),
          supersededAt: null as unknown as Date,
        },
      })

      if (durationRow) {
        const durationAssignment = asAssignmentRow(durationRow)
        if (durationAssignment.effectiveAt <= now) {
          const resolved = await this.loadProfileByRef(
            durationAssignment.profileRef,
            'DURATION',
            durationAssignment.scopeValue,
            durationAssignment.key
          )
          if (resolved) return resolved
        }
      }
    }

    // 3. Kiểm tra GLOBAL assignment
    const globalRow = await this.configRepo.findOne({
      where: {
        kind: 'assignment',
        scope: 'GLOBAL',
        supersededAt: null as unknown as Date,
      },
    })

    if (globalRow) {
      const globalAssignment = asAssignmentRow(globalRow)
      if (globalAssignment.effectiveAt <= now) {
        const resolved = await this.loadProfileByRef(
          globalAssignment.profileRef,
          'GLOBAL',
          null,
          globalAssignment.key
        )
        if (resolved) return resolved
      }
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
    ref: ProfileReference,
    scope: FlowAssignmentScope,
    scopeValue: string | null,
    assignmentId: string
  ): Promise<ResolvedFlowConfigResult | null> {
    const profileRow = await this.configRepo.findOne({
      where: {
        kind: 'profile',
        key: ref.profileId,
        status: 'published',
        version: ref.version,
      },
    })

    if (!profileRow) {
      this.logger.warn(
        `Assignment [${assignmentId}] references non-existent profile [${ref.profileId} v${ref.version}]. Falling back to lower precedence.`
      )
      return null
    }

    const profile = asProfileRow(profileRow)
    return {
      effectiveConfig: profile.steps,
      resolvedFrom: {
        scope,
        scopeValue,
        profileId: profile.key,
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
