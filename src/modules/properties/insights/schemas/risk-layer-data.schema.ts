import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * @deprecated G-DST: gộp vào `DistrictData` (collection `district_data`, `kind: 'risk-layer'`).
 * Giữ lại để đọc collection cũ và migration 017. Không đăng ký forFeature, không ghi mới.
 */
@Entity('risk_layer_data')
export class RiskLayerData {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  district!: string

  @Column()
  layerType!: string

  @Column()
  severity!: number

  @Column()
  source!: string

  @Column()
  timestamp!: Date

  @Column()
  confidence!: number

  @Column({ nullable: true, default: null })
  geoJson!: Record<string, unknown> | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
