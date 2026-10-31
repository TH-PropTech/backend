import { describe, expect, it } from 'vitest'
import {
  MOVE_IN_SETTLEMENT_OVERDUE_BODY,
  MOVE_IN_SETTLEMENT_OVERDUE_LEGACY_TITLE,
  MOVE_IN_SETTLEMENT_OVERDUE_TITLE,
} from './move-in-settlement-overdue.message'

describe('move-in settlement overdue message', () => {
  it('is Vietnamese and free of internal codes', () => {
    for (const text of [
      MOVE_IN_SETTLEMENT_OVERDUE_TITLE,
      MOVE_IN_SETTLEMENT_OVERDUE_BODY,
    ]) {
      expect(text).not.toMatch(/Settlement/i)
      expect(text).not.toMatch(/[0-9a-f]{24}/i)
    }
    expect(MOVE_IN_SETTLEMENT_OVERDUE_TITLE).not.toBe(
      MOVE_IN_SETTLEMENT_OVERDUE_LEGACY_TITLE
    )
  })
})
