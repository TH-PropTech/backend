import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { SystemConfig } from '../../properties/schemas/system-config.schema'
import type { PlatformFeeScheduleRules } from './platform-fee.types'

/** Giá trị `SystemConfig.scope` của biểu phí nền tảng. */
export const PLATFORM_FEE_SCOPE = 'platform-fee' as const

/**
 * Hình biểu phí như `PlatformFeeSchedule` cũ (không có `scope`/`key`).
 * `contentHash` vẫn là băm `rules` cũ; governance đọc đúng trường này.
 */
export interface PlatformFeeScheduleView {
  _id: ObjectId
  scheduleId: string
  version: number
  status: 'draft' | 'published' | 'archived'
  effectiveFrom?: Date | null
  rules: PlatformFeeScheduleRules
  legalReviewStatus: 'draft' | 'reviewed'
  reviewReference?: string | null
  contentHash?: string | null
  draftRevision: number
  createdBy: string
  publishedBy?: string | null
  publishedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

type FeeRow = Partial<SystemConfig> & { _id: ObjectId }
type FeeWhere = Partial<
  Pick<PlatformFeeScheduleView, 'scheduleId' | 'version' | 'status'>
>

/**
 * Facade lưu biểu phí trong `system_configs{scope:'platform-fee'}` (G-CFG2).
 * Chữ ký giống `Repository<PlatformFeeSchedule>` mà `PlatformFeesService` dùng trước đây:
 * mọi `where` tự thêm `scope`, `key` = `scheduleId@version` (unique cùng `scope`),
 * và kết quả bỏ `scope`/`key`.
 */
@Injectable()
export class PlatformFeeScheduleRepository {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly repo: Repository<SystemConfig>
  ) {}

  async findOne(options: {
    where: Pick<PlatformFeeScheduleView, 'scheduleId' | 'version'>
  }): Promise<PlatformFeeScheduleView | null> {
    const row = await this.repo.findOne({
      where: { scope: PLATFORM_FEE_SCOPE, ...options.where },
    })
    return row ? toView(row) : null
  }

  async find(options: { where: FeeWhere }): Promise<PlatformFeeScheduleView[]> {
    const rows = await this.repo.find({
      where: { scope: PLATFORM_FEE_SCOPE, ...options.where } as never,
    })
    return rows.map(row => toView(row as FeeRow))
  }

  create(value: Partial<PlatformFeeScheduleView>): PlatformFeeScheduleView {
    return value as PlatformFeeScheduleView
  }

  async save(
    value: Partial<PlatformFeeScheduleView>
  ): Promise<PlatformFeeScheduleView> {
    const row = await this.repo.save({
      ...value,
      scope: PLATFORM_FEE_SCOPE,
      key: keyOf(value),
    } as SystemConfig)
    return toView(row)
  }
}

function keyOf(value: Partial<PlatformFeeScheduleView>): string {
  return `${value.scheduleId}@${value.version}`
}

function toView(row: FeeRow): PlatformFeeScheduleView {
  const { scope: _scope, key: _key, ...view } = row
  void _scope
  void _key
  return view as unknown as PlatformFeeScheduleView
}
