export type MigrationOptions = {
  dryRun?: boolean
}

export type MigrationReport = {
  migrationId: string
  scanned: number
  updated: number
  skipped: number
  errors: string[]
  dryRun: boolean
}

export interface MigrationRepository<T extends object> {
  find(): Promise<T[]>
  save(entity: T): Promise<T>
}
