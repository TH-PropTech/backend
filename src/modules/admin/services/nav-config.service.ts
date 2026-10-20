import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MongoRepository } from 'typeorm'
import { SystemConfig } from '../../properties/schemas/system-config.schema'

export const NAV_CONFIG_KEY = 'staff-menu'

export interface NavConfigView {
  /** Id các mục menu admin đã ẩn với nhân viên. Admin luôn thấy đủ. */
  hiddenForStaff: string[]
  updatedAt: string | null
  updatedBy: string | null
}

const DEFAULT_VIEW: NavConfigView = {
  hiddenForStaff: [],
  updatedAt: null,
  updatedBy: null,
}

const toView = (row: SystemConfig | null): NavConfigView =>
  row
    ? {
        hiddenForStaff: [...(row.hiddenTabs ?? [])],
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        updatedBy: row.updatedBy ?? null,
      }
    : { ...DEFAULT_VIEW }

/**
 * Cấu hình hiển thị menu bảng điều khiển theo vai trò (`SystemConfig{scope:'admin-nav'}`).
 * Đây là cấu hình hiển thị, không phải kiểm soát truy cập: quyền thật vẫn do guard của từng API.
 */
@Injectable()
export class NavConfigService {
  private readonly logger = new Logger(NavConfigService.name)

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepository: MongoRepository<SystemConfig>
  ) {}

  /** Lỗi đọc DB thì trả mặc định (hiện đủ menu) để bảng điều khiển không bị chặn. */
  async get(): Promise<NavConfigView> {
    try {
      return toView(await this.find())
    } catch (error) {
      this.logger.warn(
        `Failed to load nav config: ${error instanceof Error ? error.message : 'unknown'}. Using default.`
      )
      return { ...DEFAULT_VIEW }
    }
  }

  async update(
    hiddenForStaff: string[],
    adminEmail: string
  ): Promise<NavConfigView> {
    const hiddenTabs = [...new Set(hiddenForStaff)].sort()
    const now = new Date()
    // upsert nguyên tử: hai admin lưu cùng lúc không vi phạm unique (scope, key).
    await this.configRepository.updateOne(
      { scope: 'admin-nav', key: NAV_CONFIG_KEY },
      {
        $set: { hiddenTabs, updatedBy: adminEmail, updatedAt: now },
        $setOnInsert: {
          scope: 'admin-nav',
          key: NAV_CONFIG_KEY,
          createdAt: now,
        },
      },
      { upsert: true }
    )
    this.logger.log(
      `Nav config updated by ${adminEmail}: hidden for staff = [${hiddenTabs.join(', ')}]`
    )
    return toView(await this.find())
  }

  private find(): Promise<SystemConfig | null> {
    return this.configRepository.findOne({
      where: { scope: 'admin-nav', key: NAV_CONFIG_KEY },
    })
  }
}
