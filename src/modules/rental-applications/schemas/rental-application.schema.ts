import {
  Column,
  CreateDateColumn,
  Entity,
  ObjectId,
  ObjectIdColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { RentalPackageSnapshot } from '../../apartments/rental-package.util'

export type RentalApplicationStatus = 'pending' | 'accepted' | 'rejected'

@Entity('rental_applications')
export class RentalApplication {
  @ObjectIdColumn() _id!: ObjectId
  @Column() tenantId!: string
  @Column() apartmentId!: string
  @Column() landlordId!: string
  @Column({ nullable: true }) packageId?: string | null
  @Column({ nullable: true }) packageVersion?: number | null
  @Column({ nullable: true }) packageSnapshot?: RentalPackageSnapshot | null
  @Column({ nullable: true }) contractId?: string | null
  @Column() occupants!: number
  @Column() moveInDate!: Date
  @Column() leaseDurationMonths!: number
  @Column() occupation!: string
  @Column() hasPets!: boolean
  @Column({ nullable: true }) notes!: string | null
  @Column({ default: 'pending' }) status!: RentalApplicationStatus
  @Column({ nullable: true }) reasonCode!: string | null
  @Column({ nullable: true }) actorId!: string | null
  @Column({ nullable: true }) actorTimestamp!: Date | null
  @CreateDateColumn() createdAt!: Date
  @UpdateDateColumn() updatedAt!: Date
}
