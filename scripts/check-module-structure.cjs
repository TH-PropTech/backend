#!/usr/bin/env node
/* Enforces the module folder convention described in backend/README.md. Exit 1 on any violation. */
const fs = require('fs')
const path = require('path')

const MODULES = path.join(__dirname, '..', 'src', 'modules')

// Standard sub-folders allowed in every module.
const ALLOWED = new Set([
  'controllers',
  'services',
  'dto',
  'schemas',
  'utils',
  'providers',
  'gateways',
  'engine',
  'guards',
  'interfaces',
  'enums',
  'types',
  'templates',
  'strategies',
])
// Feature folders of large modules, documented exceptions: module -> allowed folders.
const EXCEPTIONS = {
  contracts: [
    'commercial',
    'flow',
    'fonts',
    'layout',
    'legal',
    'signed-artifact',
  ],
  legal: ['data'],
  properties: ['mappers', 'insights', 'recommendations'],
  jobs: ['jobs'],
}
// Loose files allowed in a module root besides *.module.ts and index.ts.
const ROOT_FILES = { jobs: ['base-job.ts'], rbac: ['rbac.constants.ts'] }

const violations = []
const walk = d =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
const rel = p =>
  path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/')

for (const mod of fs
  .readdirSync(MODULES, { withFileTypes: true })
  .filter(e => e.isDirectory())) {
  const dir = path.join(MODULES, mod.name)
  const feature = new Set(EXCEPTIONS[mod.name] ?? [])
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  const moduleFiles = entries.filter(
    e => e.isFile() && e.name.endsWith('.module.ts')
  )
  if (moduleFiles.length !== 1)
    violations.push(
      `${rel(dir)}: expected exactly one *.module.ts at root, found ${moduleFiles.length}`
    )

  for (const e of entries) {
    if (e.isDirectory()) {
      if (!ALLOWED.has(e.name) && !feature.has(e.name))
        violations.push(
          `${rel(path.join(dir, e.name))}: folder not allowed (see README convention)`
        )
    } else if (
      !e.name.endsWith('.module.ts') &&
      e.name !== 'index.ts' &&
      !(ROOT_FILES[mod.name] ?? []).includes(e.name)
    ) {
      violations.push(
        `${rel(path.join(dir, e.name))}: loose file in module root`
      )
    }
  }

  for (const f of walk(dir)) {
    const r = rel(f)
    if (f.endsWith('.entity.ts'))
      violations.push(`${r}: use *.schema.ts under schemas/`)
    if (
      f.endsWith('.schema.ts') &&
      path.basename(path.dirname(f)) !== 'schemas'
    )
      violations.push(`${r}: schema outside schemas/`)
    if (f.endsWith('.module.ts') && path.dirname(f) !== dir)
      violations.push(`${r}: *.module.ts must be at module root`)
  }
}

console.log(`violations: ${violations.length}`)
violations.forEach(v => console.error('VIOLATION: ' + v))
process.exit(violations.length ? 1 : 0)
