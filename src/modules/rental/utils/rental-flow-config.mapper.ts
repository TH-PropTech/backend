import type { ObjectId } from 'typeorm'
import type {
  FlowAssignmentScope,
  ProfileReference,
  RentalFlowConfig,
} from '../schemas/rental-flow-config.schema'
import type {
  FlowChangeClassification,
  FlowProfileStatus,
  FlowProfileSteps,
} from '../schemas/rental-flow-profile.schema'
import type {
  RentalExecutionPolicyDisclosure,
  RentalExecutionPolicyStatus,
  RentalExecutionStrategy,
} from './rental-execution-policy.util'

/** Hình JSON cũ của RentalFlowProfile (không lộ `kind`/`key`). */
export type RentalFlowProfileView = {
  _id: ObjectId
  profileId: string
  name: string
  description: string
  status: FlowProfileStatus
  version: number | null
  draftRevision: number
  contentHash: string | null
  schemaVersion: number
  changeClassification: FlowChangeClassification
  steps: FlowProfileSteps
  createdBy?: string | null
  updatedBy?: string | null
  publishedBy?: string | null
  publishedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Hình JSON cũ của RentalExecutionPolicy (không lộ `kind`/`key`). */
export type RentalExecutionPolicyView = {
  _id: ObjectId
  policyId: string
  version: number | null
  status: RentalExecutionPolicyStatus
  strategy: RentalExecutionStrategy
  name: string
  description: string
  disclosure: RentalExecutionPolicyDisclosure
  contentHash: string | null
  draftRevision: number
  createdBy?: string | null
  updatedBy?: string | null
  publishedBy?: string | null
  publishedAt?: Date | null
  archivedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Bản ghi `kind = 'profile'` với các trường riêng của profile đã chắc chắn có. */
export type ProfileConfigRow = RentalFlowConfig & {
  steps: FlowProfileSteps
  changeClassification: FlowChangeClassification
  schemaVersion: number
}

/** Hình JSON cũ của RentalFlowAssignment (không lộ `kind`/`key`). */
export type RentalFlowAssignmentView = {
  _id: ObjectId
  assignmentId: string
  scope: FlowAssignmentScope
  scopeValue: string | null
  profileRef: ProfileReference
  effectiveAt: Date
  supersededAt: Date | null
  createdBy?: string | null
  createdAt: Date
  updatedAt: Date
}

/** Bản ghi `kind = 'policy'` với các trường riêng của policy đã chắc chắn có. */
export type PolicyConfigRow = RentalFlowConfig & {
  strategy: RentalExecutionStrategy
  disclosure: RentalExecutionPolicyDisclosure
}

/** Bản ghi `kind = 'assignment'` với các trường riêng của assignment đã chắc chắn có. */
export type AssignmentConfigRow = RentalFlowConfig & {
  scope: FlowAssignmentScope
  scopeValue: string | null
  profileRef: ProfileReference
  effectiveAt: Date
  supersededAt: Date | null
}

export function asProfileRow(row: RentalFlowConfig): ProfileConfigRow {
  return row as ProfileConfigRow
}

export function asPolicyRow(row: RentalFlowConfig): PolicyConfigRow {
  return row as PolicyConfigRow
}

export function asAssignmentRow(row: RentalFlowConfig): AssignmentConfigRow {
  return row as AssignmentConfigRow
}

/** Chỉ giữ khóa có giá trị (khác undefined) để JSON khớp bản ghi cũ. */
function defined<T>(value: object): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T
}

export function toProfileView(row: RentalFlowConfig): RentalFlowProfileView {
  const profile = asProfileRow(row)
  return defined<RentalFlowProfileView>({
    _id: profile._id,
    profileId: profile.key,
    name: profile.name,
    description: profile.description,
    status: profile.status,
    version: profile.version,
    draftRevision: profile.draftRevision,
    contentHash: profile.contentHash,
    schemaVersion: profile.schemaVersion,
    changeClassification: profile.changeClassification,
    steps: profile.steps,
    createdBy: profile.createdBy,
    updatedBy: profile.updatedBy,
    publishedBy: profile.publishedBy,
    publishedAt: profile.publishedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  })
}

export function toPolicyView(row: RentalFlowConfig): RentalExecutionPolicyView {
  const policy = asPolicyRow(row)
  return defined<RentalExecutionPolicyView>({
    _id: policy._id,
    policyId: policy.key,
    version: policy.version,
    status: policy.status,
    strategy: policy.strategy,
    name: policy.name,
    description: policy.description,
    disclosure: policy.disclosure,
    contentHash: policy.contentHash,
    draftRevision: policy.draftRevision,
    createdBy: policy.createdBy,
    updatedBy: policy.updatedBy,
    publishedBy: policy.publishedBy,
    publishedAt: policy.publishedAt,
    archivedAt: policy.archivedAt,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  })
}

export function toAssignmentView(
  row: RentalFlowConfig
): RentalFlowAssignmentView {
  const assignment = asAssignmentRow(row)
  return defined<RentalFlowAssignmentView>({
    _id: assignment._id,
    assignmentId: assignment.key,
    scope: assignment.scope,
    scopeValue: assignment.scopeValue,
    profileRef: assignment.profileRef,
    effectiveAt: assignment.effectiveAt,
    supersededAt: assignment.supersededAt,
    createdBy: assignment.createdBy,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  })
}
