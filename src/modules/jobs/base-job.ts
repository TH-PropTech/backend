import { Logger } from '@nestjs/common'
import type {
  JobRunHistory,
  JobRunTrigger,
} from './schemas/job-run-history.schema'

/** Kho lịch sử chạy job (facade trên `activity_logs`, kind 'job-run'). */
export interface JobRunHistoryStore {
  create(data: Partial<JobRunHistory>): JobRunHistory
  save(entity: JobRunHistory): Promise<JobRunHistory>
}

export interface JobRunOutcome {
  jobName: string
  trigger: JobRunTrigger
  status: 'success' | 'error'
  startedAt: Date
  finishedAt: Date
  durationMs: number
  result: unknown
  error: string | null
}

/**
 * Lớp cơ sở cho mọi job nền. Job chỉ khai báo tên, lịch cron và `run()`;
 * JobManagerService đăng ký lịch, còn `execute()` bọc `run()` để ghi lịch sử
 * (bắt đầu / kết thúc / lỗi) mà không bao giờ ném lỗi ra ngoài.
 */
export abstract class BaseJob {
  /** Tên duy nhất; cũng là tên cron trong SchedulerRegistry. */
  abstract readonly name: string
  abstract readonly description: string
  /** Biểu thức cron (hoặc giá trị CronExpression). */
  abstract readonly cron: string
  readonly timeZone?: string

  protected readonly logger = new Logger(this.constructor.name)
  private historyRepository: JobRunHistoryStore | null = null

  /** Logic của job; ném lỗi nếu thất bại. */
  abstract run(): Promise<unknown>

  attachHistory(repository: JobRunHistoryStore): void {
    this.historyRepository = repository
  }

  async execute(trigger: JobRunTrigger): Promise<JobRunOutcome> {
    const startedAt = new Date()
    const record = await this.startRecord(trigger, startedAt)
    let result: unknown = null
    let error: string | null = null
    try {
      result = (await this.run()) ?? null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      this.logger.error(`Job ${this.name} failed: ${error}`)
    }
    const finishedAt = new Date()
    const outcome: JobRunOutcome = {
      jobName: this.name,
      trigger,
      status: error ? 'error' : 'success',
      startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      result,
      error,
    }
    await this.finishRecord(record, outcome)
    return outcome
  }

  private async startRecord(
    trigger: JobRunTrigger,
    startedAt: Date
  ): Promise<JobRunHistory | null> {
    if (!this.historyRepository) return null
    try {
      return await this.historyRepository.save(
        this.historyRepository.create({
          jobName: this.name,
          trigger,
          status: 'running',
          startedAt,
          finishedAt: null,
          durationMs: null,
          result: null,
          error: null,
        })
      )
    } catch (err) {
      this.logger.warn(`Could not record start of ${this.name}: ${String(err)}`)
      return null
    }
  }

  private async finishRecord(
    record: JobRunHistory | null,
    outcome: JobRunOutcome
  ): Promise<void> {
    if (!this.historyRepository || !record) return
    try {
      record.status = outcome.status
      record.finishedAt = outcome.finishedAt
      record.durationMs = outcome.durationMs
      record.result = outcome.result
      record.error = outcome.error
      await this.historyRepository.save(record)
    } catch (err) {
      this.logger.warn(`Could not record end of ${this.name}: ${String(err)}`)
    }
  }
}
