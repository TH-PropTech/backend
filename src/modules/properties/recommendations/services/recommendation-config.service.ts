import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { EngineStrategy } from '../engine/naive-bayes.types'
import {
  RECOMMENDATION_CONFIG_KEY,
  toRecommendationConfigView,
  type RecommendationConfigView,
} from '../../mappers/recommendation-config.mapper'
import { SystemConfig } from '../../schemas/system-config.schema'

export interface UpdateEngineConfigPayload {
  strategy: EngineStrategy
  alpha: number
  nbWeight: number
  ruleWeight: number
}

const DEFAULT_CONFIG: Omit<
  RecommendationConfigView,
  '_id' | 'updatedAt' | 'updatedBy'
> = {
  configId: RECOMMENDATION_CONFIG_KEY,
  strategy: 'hybrid',
  alpha: 1.0,
  nbWeight: 0.5,
  ruleWeight: 0.5,
}

/** Giá trị mặc định khi tạo bản ghi `SystemConfig{scope:'recommendation'}`. */
const DEFAULT_ROW = {
  scope: 'recommendation' as const,
  key: RECOMMENDATION_CONFIG_KEY,
  strategy: DEFAULT_CONFIG.strategy,
  alpha: DEFAULT_CONFIG.alpha,
  nbWeight: DEFAULT_CONFIG.nbWeight,
  ruleWeight: DEFAULT_CONFIG.ruleWeight,
}

@Injectable()
export class RecommendationConfigService {
  private readonly logger = new Logger(RecommendationConfigService.name)

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepository: Repository<SystemConfig>
  ) {}

  /**
   * Returns the global engine config.
   * If no document exists, an upsert is performed with the default config,
   * ensuring the engine always has a valid configuration available.
   * Shape is the legacy API shape (`configId`, no `scope`/`key`).
   */
  async getConfig(): Promise<RecommendationConfigView> {
    try {
      return toRecommendationConfigView(await this.loadOrCreate())
    } catch (error) {
      return this.inMemoryDefault(error)
    }
  }

  /**
   * Persists an updated engine config and returns the saved document.
   *
   * @param payload - Validated strategy + hyperparameter payload
   * @param adminEmail - Email of the requesting admin (audit trail)
   */
  async updateConfig(
    payload: UpdateEngineConfigPayload,
    adminEmail: string
  ): Promise<RecommendationConfigView> {
    let current: SystemConfig
    try {
      current = await this.loadOrCreate()
    } catch (error) {
      this.inMemoryDefault(error)
      current = this.configRepository.create({ ...DEFAULT_ROW })
    }

    const updated = this.configRepository.merge(current, {
      strategy: payload.strategy,
      alpha: payload.alpha,
      nbWeight: payload.nbWeight,
      ruleWeight: payload.ruleWeight,
      updatedBy: adminEmail,
    })

    const saved = await this.configRepository.save(updated)
    this.logger.log(
      `Engine config updated by ${adminEmail}: strategy=${saved.strategy}, alpha=${saved.alpha}, nbWeight=${saved.nbWeight}, ruleWeight=${saved.ruleWeight}`
    )
    return toRecommendationConfigView(saved)
  }

  /** Bản ghi `SystemConfig{scope:'recommendation', key:'global'}`; tạo mặc định nếu chưa có. */
  private async loadOrCreate(): Promise<SystemConfig> {
    const existing = await this.configRepository.findOne({
      where: { scope: 'recommendation', key: RECOMMENDATION_CONFIG_KEY },
    })
    if (existing) return existing

    // First-time initialisation — upsert default config
    this.logger.log(
      'No engine config found — initialising with default hybrid config.'
    )
    return this.configRepository.save(
      this.configRepository.create({ ...DEFAULT_ROW })
    )
  }

  /** Return an in-memory default so the engine never crashes. */
  private inMemoryDefault(error: unknown): RecommendationConfigView {
    const msg = error instanceof Error ? error.message : String(error)
    this.logger.warn(
      `Failed to fetch engine config: ${msg}. Returning in-memory default.`
    )
    return {
      _id: null as unknown as import('typeorm').ObjectId,
      updatedAt: new Date(),
      ...DEFAULT_CONFIG,
    }
  }
}
