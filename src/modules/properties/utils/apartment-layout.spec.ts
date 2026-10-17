import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isApartmentLayoutEmpty,
  normalizeApartmentLayout,
} from './apartment-layout'

interface Case {
  name: string
  input: unknown
  expected: unknown
}

const fixtures = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'layout-cases.json'), 'utf8')
) as { cases: Case[] }

describe('normalizeApartmentLayout (shared fixtures with the 3D viewer)', () => {
  it.each(fixtures.cases.map(c => [c.name, c] as const))('%s', (_, c) => {
    expect(normalizeApartmentLayout(c.input)).toEqual(c.expected)
  })

  it('is idempotent for every fixture', () => {
    for (const c of fixtures.cases) {
      const once = normalizeApartmentLayout(c.input)
      expect(normalizeApartmentLayout(once)).toEqual(once)
    }
  })

  it('treats a layout with only defaults as empty', () => {
    expect(isApartmentLayoutEmpty(normalizeApartmentLayout(null))).toBe(true)
    expect(
      isApartmentLayoutEmpty(
        normalizeApartmentLayout({ rooms: { living: { floor: 'tile' } } })
      )
    ).toBe(false)
  })
})
