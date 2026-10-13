import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import {
  RecommendationConfig,
  EngineStrategy,
} from '../entities/recommendation-config.entity'

export interface UpdateEngineConfigPayload {
  strategy: EngineStrategy
  alpha: number
  nbWeight: number
  ruleWeight: number
}

const DEFAULT_CONFIG: Omit<
  RecommendationConfig,
  '_id' | 'updatedAt' | 'updatedBy'
> = {
  configId: 'global',
  strategy: 'hybrid',
  alpha: 1.0,
  nbWeight: 0.5,
  ruleWeight: 0.5,
}

@Injectable()
export class RecommendationConfigService {
  private readonly logger = new Logger(RecommendationConfigService.name)

  constructor(
    @InjectRepository(RecommendationConfig)
    private readonly configRepository: Repository<RecommendationConfig>
  ) {}

  /**
   * Returns the global engine config.
   * If no document exists, an upsert is performed with the default config,
   * ensuring the engine always has a valid configuration available.
   */
  async getConfig(): Promise<RecommendationConfig> {
    try {
      const existing = await this.configRepository.findOne({
        where: { configId: 'global' },
      })

      if (existing) {
        return existing
      }

      // First-time initialisation — upsert default config
      this.logger.log(
        'No engine config found — initialising with default hybrid config.'
      )
      const defaultEntity = this.configRepository.create({
        ...DEFAULT_CONFIG,
      })
      return await this.configRepository.save(defaultEntity)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Failed to fetch engine config: ${msg}. Returning in-memory default.`
      )
      // Return an in-memory default so the engine never crashes
      return {
        _id: null as unknown as import('typeorm').ObjectId,
        updatedAt: new Date(),
        ...DEFAULT_CONFIG,
      }
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
  ): Promise<RecommendationConfig> {
    const current = await this.getConfig()

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
    return saved
  }
}
