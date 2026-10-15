import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  UpdateDateColumn,
} from 'typeorm'
import { EngineStrategy } from '../engine/naive-bayes.types'

export { EngineStrategy }

/**
 * @deprecated G-CFG: thay bằng `SystemConfig{scope:'recommendation', key:'global'}`
 * (`schemas/system-config.schema.ts`). Giữ file để rollback/migration 013; không đăng ký
 * trong `forFeature`. Collection `recommendation_configs` không bị xóa.
 */
@Entity('recommendation_configs')
export class RecommendationConfig {
  @ObjectIdColumn()
  _id!: ObjectId

  /**
   * Singleton document key — always "global".
   * Only one config document exists in the collection.
   */
  @Column({ default: 'global' })
  configId!: string

  /** Active recommendation strategy. */
  @Column({ default: 'hybrid' })
  strategy!: EngineStrategy

  /**
   * Dirichlet prior concentration for MAP Bayesian smoothing.
   * alpha = 1.0 is equivalent to Laplace smoothing (default hybrid behaviour).
   * Minimum: 0.1
   */
  @Column({ default: 1.0 })
  alpha!: number

  /**
   * Weight for the Naive Bayes score pillar (0–1).
   * Must satisfy: nbWeight + ruleWeight === 1.0
   */
  @Column({ default: 0.5 })
  nbWeight!: number

  /**
   * Weight for the content-based rule score pillar (0–1).
   * Must satisfy: nbWeight + ruleWeight === 1.0
   */
  @Column({ default: 0.5 })
  ruleWeight!: number

  @UpdateDateColumn()
  updatedAt!: Date

  /** Email of the admin who last updated the config. */
  @Column({ nullable: true })
  updatedBy?: string
}
