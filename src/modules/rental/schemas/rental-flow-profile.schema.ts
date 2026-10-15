import {
  Entity,
  ObjectIdColumn,
  ObjectId,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export type FlowProfileStatus = 'draft' | 'published' | 'archived'
export type FlowChangeClassification =
  | 'PRESENTATION'
  | 'APPLICATION_RULE'
  | 'CONTRACT_MATERIAL'

export interface Step1Config {
  moveInDateLabel: string
  moveInDateHelpText?: string | null
  minMoveInLeadDays: number
  maxMoveInLeadDays: number
  occupantsLabel: string
  occupantsHelpText?: string | null
  minOccupants: number
  maxOccupants: number
  enforceDensityWarning: boolean
  occupationLabel: string
  occupationPlaceholder?: string | null
  occupationRequired: boolean
  allowedOccupationSuggestions: string[]
  petsAllowedToggleVisible: boolean
  petsLabel: string
  petsBylawsNotice?: string | null
  notesLabel: string
  notesPlaceholder?: string | null
  notesMaxLength: number
  notesSuggestions: string[]
}

export interface Step2Config {
  headerTitle: string
  headerSubtitle?: string | null
  depositNoticeTitle: string
  depositNoticeBody: string
  highlightLongTermPackages: boolean
  showSubtotalEstimate: boolean
  paymentScheduleHelpText?: string | null
  badgeRules: Array<{
    durationMonths: number
    badgeText: string
    colorVariant: 'primary' | 'accent' | 'success'
  }>
}

export interface Step3Config {
  headerTitle: string
  headerSubtitle?: string | null
  termsReferenceKey: string
  disclosures: Array<{
    id: string
    title: string
    body: string
    required: boolean
    immutablePolicy: boolean
  }>
  legalAccordions: Array<{
    id: string
    title: string
    lawReference: string
    summary: string
    details: string[]
  }>
  consentCheckboxLabel: string
  consentStatement: string
}

export interface Step4Config {
  heroSuccessTitle: string
  heroSuccessMessage: string
  timelineSteps: Array<{
    step: number
    title: string
    desc: string
  }>
  decree96ReferenceVisible: boolean
  customNoticeTitle?: string | null
  customNoticeBody?: string | null
  ctaBackText: string
  ctaFollowUpText: string
}

export interface FlowProfileSteps {
  step1: Step1Config
  step2: Step2Config
  step3: Step3Config
  step4: Step4Config
}

/**
 * @deprecated Đã hợp nhất vào `RentalFlowConfig` (kind 'profile'); giữ lại để đọc collection cũ và migration 014. Không đăng ký forFeature, không ghi mới. Các kiểu StepNConfig và FlowProfileSteps vẫn dùng chung.
 */
@Entity('rental_flow_profiles')
export class RentalFlowProfile {
  @ObjectIdColumn()
  _id!: ObjectId

  @Column()
  profileId!: string

  @Column()
  name!: string

  @Column()
  description!: string

  @Column({ type: 'string', default: 'draft' })
  status!: FlowProfileStatus

  @Column({ nullable: true })
  version!: number | null

  @Column({ default: 1 })
  draftRevision!: number

  @Column({ nullable: true })
  contentHash!: string | null

  @Column({ default: 1 })
  schemaVersion!: number

  @Column({ type: 'string', default: 'PRESENTATION' })
  changeClassification!: FlowChangeClassification

  @Column('json')
  steps!: FlowProfileSteps

  @Column({ nullable: true })
  createdBy?: string | null

  @Column({ nullable: true })
  updatedBy?: string | null

  @Column({ nullable: true })
  publishedBy?: string | null

  @Column({ nullable: true })
  publishedAt?: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
