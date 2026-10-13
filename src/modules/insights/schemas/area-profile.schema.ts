import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { NearbyFacility } from './nearby-facility.schema'

@Entity('area_profiles')
export class AreaProfile {
  @ObjectIdColumn() _id!: ObjectId
  @Column() district!: string
  @Column() city!: string
  @Column({ nullable: true }) ward?: string
  @Column() overview!: string
  @Column() facilities!: NearbyFacility[]
  @Column() source!: string
  @Column() disclaimer!: string
  @Column() lastSurveyedAt!: Date
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
