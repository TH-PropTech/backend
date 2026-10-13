import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('policies')
export class Policy {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column({ unique: true })
  key!: string

  @Column()
  value!: string

  @Column()
  description!: string

  /** Đơn vị của giá trị chính sách: %, ngày, VND, v.v. */
  @Column({ nullable: true })
  unit?: string

  /** Trích dẫn điều luật cụ thể làm căn cứ pháp lý */
  @Column({ nullable: true })
  legalReference?: string

  @Column({ type: 'string', default: 'active' })
  status!: 'active' | 'inactive'

  @Column({ nullable: true })
  updatedBy?: string

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
