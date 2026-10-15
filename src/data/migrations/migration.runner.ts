import type { MigrationOptions, MigrationReport } from './migration.types'

export type MigrationStep = {
  id: string
  run: (options: MigrationOptions) => Promise<MigrationReport>
}

export interface MigrationCheckpointStore {
  hasCompleted(migrationId: string): Promise<boolean>
  markCompleted(migrationId: string, report: MigrationReport): Promise<void>
  /** Xóa checkpoint sau khi rollback thật, để lần apply kế tiếp chạy lại. */
  clearCompleted?(migrationId: string): Promise<void>
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
      // Chỉ checkpoint khi bước báo đã áp dụng (`dryRun === false`). Báo cáo
      // không có `dryRun` (migration 004-006 cũ) coi như đã áp dụng.
      const reported = (report as { dryRun?: boolean }).dryRun
      const applied = reported === false || reported === undefined
      if (!options.dryRun && applied && report.errors.length === 0) {
        await this.checkpointStore.markCompleted(step.id, report)
      }
    }
    return reports
  }
}
