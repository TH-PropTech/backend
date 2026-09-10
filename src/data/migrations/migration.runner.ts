import type { MigrationOptions, MigrationReport } from './migration.types'

export type MigrationStep = {
  id: string
  run: (options: MigrationOptions) => Promise<MigrationReport>
}

export interface MigrationCheckpointStore {
  hasCompleted(migrationId: string): Promise<boolean>
  markCompleted(migrationId: string, report: MigrationReport): Promise<void>
}

export class MigrationRunner {
  constructor(
    private readonly steps: readonly MigrationStep[],
    private readonly checkpointStore: MigrationCheckpointStore
  ) {}

  async run(options: MigrationOptions = {}): Promise<MigrationReport[]> {
    const reports: MigrationReport[] = []
    for (const step of this.steps) {
      if (!options.dryRun && (await this.checkpointStore.hasCompleted(step.id)))
        continue
      const report = await step.run(options)
      reports.push(report)
      if (!options.dryRun && report.errors.length === 0) {
        await this.checkpointStore.markCompleted(step.id, report)
      }
    }
    return reports
  }
}
