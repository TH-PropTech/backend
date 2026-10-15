import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindOptionsWhere, Repository } from 'typeorm'
import { ActivityLog } from '../schemas/activity-log.schema'
import {
  toHttpActivityLog,
  type HttpActivityLog,
} from '../utils/legacy-log.mapper'

/** Đầu vào ghi nhật ký HTTP; `kind` do service gán ('http'). */
export type CreateActivityLogInput = Omit<
  ActivityLog,
  '_id' | 'createdAt' | 'updatedAt' | 'kind'
> &
  Required<
    Pick<ActivityLog, 'userId' | 'userRole' | 'method' | 'path' | 'action'>
  >

export interface ActivityLogPage {
  logs: HttpActivityLog[]
  total: number
  page: number
  limit: number
}

const MAX_LIMIT = 100
const SENSITIVE_KEYS = [
  'password',
  'newPassword',
  'oldPassword',
  'pin',
  'otp',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
]

function clampPage(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 20
  return Math.min(Math.floor(value), MAX_LIMIT)
}

/** Bỏ các trường nhạy cảm (đệ quy) trước khi lưu body request. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        SENSITIVE_KEYS.some(k => k.toLowerCase() === key.toLowerCase())
          ? '[REDACTED]'
          : redactSensitive(v),
      ])
    )
  }
  return value
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name)

  constructor(
    @InjectRepository(ActivityLog)
    private readonly repository: Repository<ActivityLog>
  ) {}

  /** Ghi một bản ghi; body request được lọc trường nhạy cảm. */
  async create(data: CreateActivityLogInput): Promise<ActivityLog> {
    try {
      const { requestBody, ...rest } = data
      const entry = this.repository.create({
        ...rest,
        kind: 'http',
        ...(requestBody
          ? {
              requestBody: redactSensitive(requestBody) as Record<
                string,
                unknown
              >,
            }
          : {}),
      })
      return await this.repository.save(entry)
    } catch (err) {
      this.logger.error('Ghi activity log thất bại', (err as Error).stack)
      throw err
    }
  }

  /** Danh sách log mới nhất trước, có phân trang. */
  async findAll(page = 1, limit = 20): Promise<ActivityLogPage> {
    return this.paginate({}, page, limit)
  }

  /** Log theo userId, có phân trang. */
  async findByUser(
    userId: string,
    page = 1,
    limit = 20
  ): Promise<ActivityLogPage> {
    return this.paginate({ userId }, page, limit)
  }

  private async paginate(
    where: Partial<Pick<ActivityLog, 'userId'>>,
    page: number,
    limit: number
  ): Promise<ActivityLogPage> {
    const safePage = clampPage(page)
    const safeLimit = clampLimit(limit)
    // Chỉ đọc loại `http` (activity_logs còn chứa job-run, blockchain, ...); hình trả về không có `kind`.
    const [rows, total] = await this.repository.findAndCount({
      where: { ...where, kind: 'http' } as FindOptionsWhere<ActivityLog>,
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    })
    return {
      logs: rows.map(toHttpActivityLog),
      total,
      page: safePage,
      limit: safeLimit,
    }
  }
}
