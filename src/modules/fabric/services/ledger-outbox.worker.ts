import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { LedgerOutboxService } from './ledger-outbox.service'

const DEFAULT_POLL_INTERVAL_MS = 5000

@Injectable()
export class LedgerOutboxWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LedgerOutboxWorker.name)
  private isRunning = false
  private timer: NodeJS.Timeout | null = null
  private readonly pollIntervalMs: number

  constructor(
    private readonly outboxService: LedgerOutboxService,
    @Optional() configService?: ConfigService
  ) {
    this.pollIntervalMs =
      configService?.get<number>('fabric.outboxPollIntervalMs') ??
      DEFAULT_POLL_INTERVAL_MS
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(
      `Starting LedgerOutboxWorker with polling interval ${this.pollIntervalMs}ms`
    )
    await this.runLoop()
    this.timer = setInterval(() => {
      void this.runLoop()
    }, this.pollIntervalMs)
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      this.logger.log('LedgerOutboxWorker timer stopped')
    }
  }

  async runLoop(): Promise<void> {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    try {
      await this.outboxService.processPending()
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      this.logger.error(`Error in LedgerOutboxWorker loop: ${errMsg}`)
    } finally {
      this.isRunning = false
    }
  }
}
