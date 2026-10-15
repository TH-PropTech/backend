import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { NearbyFacility } from './nearby-facility.schema'

/** Phân loại bản ghi dữ liệu theo quận; mọi truy vấn bắt buộc lọc theo kind. */
export type DistrictDataKind = 'area-profile' | 'risk-layer'

/**
 * Dữ liệu theo quận, hợp nhất AreaProfile (kind 'area-profile') và RiskLayerData
 * (kind 'risk-layer'); giữ `_id` cũ. Trường riêng của từng kind để nullable và
 * DTO kiểm tra khi tạo. Không lộ `kind` ra API (xem mapper).
 *
 * Không có unique nào: hai entity cũ không có unique nên không tái tạo unique.
 */
@Entity('district_data')
// Tên trùng migration 017 (DISTRICT_DATA_INDEXES).
@Index('district_data_kind_district_city', ['kind', 'district', 'city'])
@Index('district_data_kind_district_timestamp', [
  'kind',
  'district',
  'timestamp',
])
@Index('district_data_kind_updatedAt', ['kind', 'updatedAt'])
export class DistrictData {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: DistrictDataKind

  @Column()
  district!: string

  @Column({ nullable: true })
  city?: string

  @Column({ nullable: true })
  ward?: string

  @Column({ nullable: true })
  overview?: string

  @Column('json', { nullable: true })
  facilities?: NearbyFacility[]

  @Column()
  source!: string

  @Column({ nullable: true })
  disclaimer?: string

  @Column({ nullable: true })
  lastSurveyedAt?: Date

  @Column({ nullable: true })
  layerType?: string

  @Column({ nullable: true })
  severity?: number

  @Column({ nullable: true })
  timestamp?: Date

  @Column({ nullable: true })
  confidence?: number

  @Column({ nullable: true, default: null })
  geoJson?: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
