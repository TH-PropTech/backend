import * as fs from 'node:fs'
import * as path from 'node:path'

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.fixtures.ts')
      ? [full]
      : []
  })
}

describe('non-scanning readiness probe (PROP-399 task 6.5 grep check)', () => {
  it('no production code path evaluates getAllContracts (full CONTRACT_ range scan)', () => {
    const srcRoot = path.resolve(__dirname, '..', '..', '..')
    const offenders = sourceFiles(srcRoot).filter(file =>
      fs.readFileSync(file, 'utf8').includes('getAllContracts')
    )
    expect(offenders.map(file => path.relative(srcRoot, file))).toEqual([])
  })
})
