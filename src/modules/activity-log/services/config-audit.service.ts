import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ActivityLog } from '../schemas/activity-log.schema'
import {
  ConfigAudit,
  type ConfigAuditScope,
} from '../schemas/config-audit.schema'
import { KindScopedActivityLogRepository } from '../utils/kind-scoped-activity-log.repository'
import { toConfigAudit } from '../utils/legacy-log.mapper'

export type ConfigAuditInput = Omit<ConfigAudit, '_id' | 'createdAt'>

/**
 * Ghi nối đuôi và đọc kiểm toán cấu hình; không có API sửa/xóa (bằng chứng quản trị bất biến).
 * Lưu trong `activity_logs` với `kind: 'config-audit'` (facade giữ chữ ký của repo cũ).
 */
@Injectable()
export class ConfigAuditService {
  private readonly audits: KindScopedActivityLogRepository<ConfigAudit>

  constructor(
    @InjectRepository(ActivityLog)
    repository: Repository<ActivityLog>
  ) {
    this.audits = new KindScopedActivityLogRepository<ConfigAudit>(
      repository,
      'config-audit',
      toConfigAudit
    )
  }

  async append(input: ConfigAuditInput): Promise<void> {
    await this.audits.save(this.audits.create(input))
  }

  /** Lịch sử theo khóa đối tượng, cũ trước; `version` chỉ áp dụng khi truthy (giữ hành vi cũ). */
  async findByKey(
    scope: ConfigAuditScope,
    key: string,
    version?: number
  ): Promise<ConfigAudit[]> {
    return this.audits.find({
      where: version ? { scope, key, version } : { scope, key },
      order: { createdAt: 'ASC' },
    })
  }

  /** `limit` bản ghi mới nhất của một scope, mới trước. */
  async findRecent(
    scope: ConfigAuditScope,
    limit = 100
  ): Promise<ConfigAudit[]> {
    return this.audits.find({
      where: { scope },
      order: { createdAt: 'DESC' },
      take: limit,
    })
  }
}
