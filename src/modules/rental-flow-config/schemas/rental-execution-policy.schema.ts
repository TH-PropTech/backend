import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  RentalExecutionPolicyDisclosure,
  RentalExecutionPolicyStatus,
  RentalExecutionStrategy,
} from '../utils/rental-execution-policy.util'

@Entity('rental_execution_policies')
export class RentalExecutionPolicy {
  @ObjectIdColumn() _id!: ObjectId

  @Column() policyId!: string
  @Column({ nullable: true }) version!: number | null
  @Column({ type: 'string' }) status!: RentalExecutionPolicyStatus
  @Column({ type: 'string' }) strategy!: RentalExecutionStrategy
  @Column() name!: string
  @Column() description!: string
  @Column('json') disclosure!: RentalExecutionPolicyDisclosure
  @Column({ nullable: true }) contentHash!: string | null
  @Column({ default: 1 }) draftRevision!: number
  @Column({ nullable: true }) createdBy?: string | null
  @Column({ nullable: true }) updatedBy?: string | null
  @Column({ nullable: true }) publishedBy?: string | null
  @Column({ nullable: true }) publishedAt?: Date | null
  @Column({ nullable: true }) archivedAt?: Date | null

  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
