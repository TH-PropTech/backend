import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash } from 'node:crypto'
import { Repository } from 'typeorm'
import { calculateFeeQuote } from './fee-calculator'
import { validateFeeRules } from './fee-rules.validator'
import type { PlatformFeeScheduleRules } from './platform-fee.types'
import { PlatformFeeAudit } from './schemas/platform-fee-audit.schema'
import { PlatformFeeSchedule } from './schemas/platform-fee-schedule.schema'
import { Payment } from '../payments/schemas/payment.schema'

@Injectable()
export class PlatformFeesService {
  constructor(
    @InjectRepository(PlatformFeeSchedule)
    private readonly scheduleRepo: Repository<PlatformFeeSchedule>,
    @InjectRepository(PlatformFeeAudit)
    private readonly auditRepo: Repository<PlatformFeeAudit>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>
  ) {}

  async saveDraft(
    input: {
      scheduleId: string
      rules: PlatformFeeScheduleRules
      legalReviewStatus?: 'draft' | 'reviewed'
      reviewReference?: string
      reason: string
    },
    actorId: string,
    version = 1
  ): Promise<PlatformFeeSchedule> {
    const existing = await this.scheduleRepo.findOne({
      where: { scheduleId: input.scheduleId, version },
    })
    if (existing?.status !== undefined && existing.status !== 'draft')
      throw new ConflictException('PLATFORM_FEE_SCHEDULE_IMMUTABLE')
    const errors = validateFeeRules(input.rules)
    if (errors.length)
      throw new ConflictException({
        message: 'PLATFORM_FEE_SCHEDULE_INVALID',
        errors,
      })
    const beforeHash = existing?.contentHash ?? null
    const contentHash = this.hash(input.rules)
    const entity = this.scheduleRepo.create({
      ...(existing ?? {}),
      scheduleId: input.scheduleId,
      version,
      status: 'draft',
      rules: input.rules,
      legalReviewStatus: input.legalReviewStatus ?? 'draft',
      reviewReference: input.reviewReference ?? null,
      contentHash,
      draftRevision: (existing?.draftRevision ?? 0) + 1,
      createdBy: existing?.createdBy ?? actorId,
    })
    const saved = await this.scheduleRepo.save(entity)
    await this.audit(
      saved,
      'draft-saved',
      actorId,
      input.reason,
      ['rules', 'legalReviewStatus', 'reviewReference'],
      beforeHash,
      contentHash
    )
    return saved
  }

  async validate(
    scheduleId: string,
    version: number
  ): Promise<{ valid: boolean; errors: string[] }> {
    const schedule = await this.find(scheduleId, version)
    const errors = validateFeeRules(schedule.rules)
    return { valid: errors.length === 0, errors }
  }

  async publish(
    scheduleId: string,
    version: number,
    effectiveFrom: Date,
    actorId: string,
    reason: string
  ): Promise<PlatformFeeSchedule> {
    const schedule = await this.find(scheduleId, version)
    if (schedule.status !== 'draft')
      throw new ConflictException('PLATFORM_FEE_SCHEDULE_IMMUTABLE')
    if (
      schedule.legalReviewStatus !== 'reviewed' ||
      !schedule.reviewReference?.trim()
    )
      throw new ConflictException('PLATFORM_FEE_LEGAL_REVIEW_REQUIRED')
    const errors = validateFeeRules(schedule.rules)
    if (errors.length)
      throw new ConflictException({
        message: 'PLATFORM_FEE_SCHEDULE_INVALID',
        errors,
      })
    const active = await this.scheduleRepo.find({
      where: { status: 'published' },
    })
    for (const old of active) {
      if (old.effectiveFrom && old.effectiveFrom <= effectiveFrom) {
        old.status = 'archived'
        await this.scheduleRepo.save(old)
      }
    }
    schedule.status = 'published'
    schedule.effectiveFrom = effectiveFrom
    schedule.publishedBy = actorId
    schedule.publishedAt = new Date()
    const saved = await this.scheduleRepo.save(schedule)
    await this.audit(
      saved,
      'published',
      actorId,
      reason,
      ['status', 'effectiveFrom'],
      schedule.contentHash ?? null,
      schedule.contentHash ?? null
    )
    return saved
  }

  async archive(
    scheduleId: string,
    version: number,
    actorId: string,
    reason: string
  ): Promise<PlatformFeeSchedule> {
    const schedule = await this.find(scheduleId, version)
    schedule.status = 'archived'
    const saved = await this.scheduleRepo.save(schedule)
    await this.audit(
      saved,
      'archived',
      actorId,
      reason,
      ['status'],
      schedule.contentHash ?? null,
      schedule.contentHash ?? null
    )
    return saved
  }

  async quote(input: { durationMonths: number; monthlyRent: number }): Promise<{
    scheduleId: string
    version: number
    contentHash: string
    quote: ReturnType<typeof calculateFeeQuote>
  } | null> {
    const schedules = await this.scheduleRepo.find({
      where: { status: 'published' },
    })
    const schedule = schedules
      .filter(item => item.effectiveFrom && item.effectiveFrom <= new Date())
      .sort(
        (a, b) =>
          (b.effectiveFrom?.getTime() ?? 0) - (a.effectiveFrom?.getTime() ?? 0)
      )[0]
    if (!schedule || !schedule.contentHash) return null
    return {
      scheduleId: schedule.scheduleId,
      version: schedule.version,
      contentHash: schedule.contentHash,
      quote: calculateFeeQuote(schedule.rules, input),
    }
  }

  async revenue(): Promise<{
    paid: number
    unpaid: number
    waived: number
    invoices: number
  }> {
    const invoices = await this.paymentRepo.find({
      where: { type: 'platform-fee' },
    })
    return invoices.reduce(
      (summary, invoice) => {
        summary.invoices += 1
        if (invoice.status === 'paid') summary.paid += invoice.amount
        else if (invoice.status === 'waived') summary.waived += invoice.amount
        else summary.unpaid += invoice.amount
        return summary
      },
      { paid: 0, unpaid: 0, waived: 0, invoices: 0 }
    )
  }

  private async find(
    scheduleId: string,
    version: number
  ): Promise<PlatformFeeSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { scheduleId, version },
    })
    if (!schedule)
      throw new NotFoundException('PLATFORM_FEE_SCHEDULE_NOT_FOUND')
    return schedule
  }

  private hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  private async audit(
    schedule: PlatformFeeSchedule,
    action: string,
    actorId: string,
    reason: string,
    changedFields: string[],
    beforeHash: string | null,
    afterHash: string | null
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        scheduleId: schedule.scheduleId,
        version: schedule.version,
        action,
        actorId,
        reason,
        changedFields,
        beforeHash,
        afterHash,
      })
    )
  }
}
