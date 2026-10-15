#!/usr/bin/env node
/* Fails (exit 1) if the NestJS module import graph has a cycle or any forwardRef is used. */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'src')
const walk = d =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })

const moduleFiles = walk(SRC).filter(f => f.endsWith('.module.ts'))
const graph = new Map()
let forwardRefs = 0

for (const f of moduleFiles) {
  const s = fs
    .readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
  const name = /export class (\w+Module)\b/.exec(s)?.[1]
  if (!name) continue
  if (/forwardRef\s*\(/.test(s)) forwardRefs++
  const block =
    /imports:\s*\[([\s\S]*?)\n\s*\],/.exec(s)?.[1] ??
    /imports:\s*\[([\s\S]*?)\]/.exec(s)?.[1] ??
    ''
  const deps = [...block.matchAll(/\b([A-Z]\w*Module)\b/g)]
    .map(m => m[1])
    .filter(d => d !== 'TypeOrmModule' && d !== 'ConfigModule' && d !== name)
  graph.set(name, [...new Set(deps)])
}

const WHITE = 0,
  GRAY = 1,
  BLACK = 2
const color = new Map([...graph.keys()].map(k => [k, WHITE]))
const cycles = []
const stack = []
const dfs = n => {
  color.set(n, GRAY)
  stack.push(n)
  for (const d of graph.get(n) ?? []) {
    if (!graph.has(d)) continue
    if (color.get(d) === GRAY)
      cycles.push([...stack.slice(stack.indexOf(d)), d].join(' -> '))
    else if (color.get(d) === WHITE) dfs(d)
  }
  stack.pop()
  color.set(n, BLACK)
}
for (const n of graph.keys()) if (color.get(n) === WHITE) dfs(n)

const edges = [...graph.values()].reduce((a, b) => a + b.length, 0)
console.log(
  `modules: ${graph.size}, edges: ${edges}, forwardRef files: ${forwardRefs}, cycles: ${cycles.length}`
)
cycles.forEach(c => console.error('CYCLE: ' + c))
if (forwardRefs > 0)
  console.error(
    'forwardRef is not allowed (use ModuleRef lazy resolution if a real cycle appears)'
  )
process.exit(cycles.length || forwardRefs ? 1 : 0)
