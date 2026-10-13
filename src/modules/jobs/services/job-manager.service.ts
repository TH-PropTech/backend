import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { CronJob } from 'cron'
import { Repository } from 'typeorm'
import { BaseJob, type JobRunOutcome } from '../base-job'
import { JobConfig } from '../schemas/job-config.schema'
import { JobRunHistory } from '../schemas/job-run-history.schema'

/** Token chứa danh sách mọi job được đăng ký (khai báo trong JobsModule). */
export const JOBS = Symbol('JOBS')

export interface JobStatus {
  name: string
  description: string
  cron: string
  timeZone: string | null
  enabled: boolean
  scheduled: boolean
  nextRunAt: Date | null
}

@Injectable()
export class JobManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobManagerService.name)
  private readonly jobs = new Map<string, BaseJob>()
  private readonly enabled = new Map<string, boolean>()

  constructor(
    @Inject(JOBS) jobs: BaseJob[],
    private readonly schedulerRegistry: SchedulerRegistry,
    @InjectRepository(JobConfig)
    private readonly configRepository: Repository<JobConfig>,
    @InjectRepository(JobRunHistory)
    private readonly historyRepository: Repository<JobRunHistory>
  ) {
    for (const job of jobs) {
      if (this.jobs.has(job.name)) {
        throw new Error(`Duplicate job name: ${job.name}`)
      }
      job.attachHistory(this.historyRepository)
      this.jobs.set(job.name, job)
    }
  }

  async onModuleInit(): Promise<void> {
    for (const job of this.jobs.values()) {
      const enabled = await this.loadEnabled(job.name)
      this.enabled.set(job.name, enabled)
      this.register(job)
      if (enabled) this.startSchedule(job.name)
      else this.logger.warn(`Job ${job.name} is disabled by config`)
    }
    this.logger.log(`Registered ${this.jobs.size} background jobs`)
  }

  onModuleDestroy(): void {
    for (const name of this.jobs.keys()) this.stopSchedule(name)
  }

  list(): JobStatus[] {
    return [...this.jobs.values()].map(job => this.toStatus(job))
  }

  async enable(name: string): Promise<JobStatus> {
    const job = this.getJob(name)
    await this.saveEnabled(name, true)
    this.enabled.set(name, true)
    this.startSchedule(name)
    return this.toStatus(job)
  }

  async disable(name: string): Promise<JobStatus> {
    const job = this.getJob(name)
    await this.saveEnabled(name, false)
    this.enabled.set(name, false)
    this.stopSchedule(name)
    return this.toStatus(job)
  }

  /** Chạy tay một job, kể cả khi đang bị tắt lịch. */
  async runNow(name: string): Promise<JobRunOutcome> {
    return this.getJob(name).execute('manual')
  }

  async history(name: string, limit = 20): Promise<JobRunHistory[]> {
    this.getJob(name)
    const take = Math.min(Math.max(Math.trunc(limit) || 20, 1), 200)
    return this.historyRepository.find({
      where: { jobName: name },
      order: { startedAt: 'DESC' },
      take,
    })
  }

  isEnabled(name: string): boolean {
    return this.enabled.get(name) ?? true
  }

  private getJob(name: string): BaseJob {
    const job = this.jobs.get(name)
    if (!job) throw new NotFoundException(`JOB_NOT_FOUND: ${name}`)
    return job
  }

  private register(job: BaseJob): void {
    const cronJob = new CronJob(
      job.cron,
      () => {
        void job.execute('cron')
      },
      null,
      false,
      job.timeZone
    )
    this.schedulerRegistry.addCronJob(job.name, cronJob)
  }

  private startSchedule(name: string): void {
    this.schedulerRegistry.getCronJob(name).start()
  }

  private stopSchedule(name: string): void {
    if (this.schedulerRegistry.doesExist('cron', name)) {
      void this.schedulerRegistry.getCronJob(name).stop()
    }
  }

  private toStatus(job: BaseJob): JobStatus {
    const cronJob = this.schedulerRegistry.doesExist('cron', job.name)
      ? this.schedulerRegistry.getCronJob(job.name)
      : null
    const scheduled = Boolean(cronJob?.isActive)
    return {
      name: job.name,
      description: job.description,
      cron: job.cron,
      timeZone: job.timeZone ?? null,
      enabled: this.isEnabled(job.name),
      scheduled,
      nextRunAt: scheduled && cronJob ? cronJob.nextDate().toJSDate() : null,
    }
  }

  /** Mặc định enabled: không có bản ghi hoặc đọc lỗi đều coi là bật. */
  private async loadEnabled(name: string): Promise<boolean> {
    try {
      const config = await this.configRepository.findOne({
        where: { jobName: name },
      })
      if (!config) {
        await this.saveEnabled(name, true)
        return true
      }
      return config.enabled !== false
    } catch (err) {
      this.logger.warn(
        `Could not read config of ${name}, treating as enabled: ${String(err)}`
      )
      return true
    }
  }

  private async saveEnabled(name: string, enabled: boolean): Promise<void> {
    try {
      const existing = await this.configRepository.findOne({
        where: { jobName: name },
      })
      if (existing) {
        existing.enabled = enabled
        await this.configRepository.save(existing)
      } else {
        await this.configRepository.save(
          this.configRepository.create({ jobName: name, enabled })
        )
      }
    } catch (err) {
      this.logger.warn(`Could not persist config of ${name}: ${String(err)}`)
    }
  }
}
