import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  FlowChangeClassification,
  FlowProfileStatus,
  FlowProfileSteps,
} from './rental-flow-profile.schema'
import type {
  RentalExecutionPolicyDisclosure,
  RentalExecutionPolicyStatus,
  RentalExecutionStrategy,
} from '../utils/rental-execution-policy.util'

/** Phân loại bản ghi cấu hình luồng thuê; mọi truy vấn bắt buộc lọc theo kind. */
export type RentalFlowConfigKind = 'profile' | 'policy' | 'assignment'

export type FlowAssignmentScope = 'GLOBAL' | 'DURATION' | 'PACKAGE'

export interface ProfileReference {
  profileId: string
  version: number
  contentHash: string
}

/**
 * Cấu hình luồng thuê dạng có phiên bản (nháp/xuất bản/lưu trữ) và gán cấu hình.
 * Hợp nhất RentalFlowProfile (kind 'profile'), RentalExecutionPolicy (kind 'policy')
 * và RentalFlowAssignment (kind 'assignment'); giữ `_id` cũ.
 * `key` = profileId | policyId | assignmentId tùy `kind`.
 * Trường riêng: profile (schemaVersion, changeClassification, steps),
 * policy (strategy, disclosure, archivedAt), assignment (scope, scopeValue,
 * profileRef, effectiveAt, supersededAt). Không lộ `kind`/`key` ra API (xem mapper).
 *
 * Chỉ mục: `(kind, key, status, version)` phục vụ truy vấn theo khóa nghiệp vụ;
 * `(kind, scope, scopeValue, supersededAt)` phục vụ bộ phân giải assignment.
 * Chỉ mục `(kind, key)` cho kind 'assignment' do migration 024 tạo (`rental_flow_configs_assignment_key`)
 * là chỉ mục THƯỜNG, KHÔNG unique: collection cũ không có unique `assignmentId` và dữ liệu thật
 * có bản ghi trùng `assignmentId`. Profile/policy cũng không có unique (nhiều bản cùng khóa).
 */
@Entity('rental_flow_configs')
// Tên trùng migration 014 (RENTAL_FLOW_CONFIG_INDEXES).
@Index('rental_flow_configs_kind_key_status_version', [
  'kind',
  'key',
  'status',
  'version',
])
@Index('rental_flow_configs_assignment_scope_superseded', [
  'kind',
  'scope',
  'scopeValue',
  'supersededAt',
])
export class RentalFlowConfig {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ type: 'string' })
  kind!: RentalFlowConfigKind

  @Column()
  key!: string

  @Column({ type: 'string' })
  status!: FlowProfileStatus | RentalExecutionPolicyStatus

  @Column({ nullable: true })
  version!: number | null

  @Column({ default: 1 })
  draftRevision!: number

  @Column({ nullable: true })
  contentHash!: string | null

  @Column()
  name!: string

  @Column()
  description!: string

  @Column({ nullable: true })
  schemaVersion?: number

  @Column({ type: 'string', nullable: true })
  changeClassification?: FlowChangeClassification

  @Column('json', { nullable: true })
  steps?: FlowProfileSteps

  @Column({ type: 'string', nullable: true })
  strategy?: RentalExecutionStrategy

  @Column('json', { nullable: true })
  disclosure?: RentalExecutionPolicyDisclosure

  @Column({ nullable: true })
  createdBy?: string | null

  @Column({ nullable: true })
  updatedBy?: string | null

  @Column({ nullable: true })
  publishedBy?: string | null

  @Column({ nullable: true })
  publishedAt?: Date | null

  @Column({ nullable: true })
  archivedAt?: Date | null

  /** Chỉ kind 'assignment': GLOBAL -> null; DURATION -> '1'|'3'|'6'|'12'; PACKAGE -> packageId. */
  @Column({ type: 'string', nullable: true })
  scope?: FlowAssignmentScope

  @Column({ nullable: true })
  scopeValue?: string | null

  @Column('json', { nullable: true })
  profileRef?: ProfileReference

  @Column({ nullable: true })
  effectiveAt?: Date

  @Column({ nullable: true })
  supersededAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
