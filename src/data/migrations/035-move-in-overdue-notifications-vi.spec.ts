import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  localizeMoveInOverdueNotifications,
  rollbackMoveInOverdueNotificationsVi,
  type NotificationsMongoDatabase,
} from './035-move-in-overdue-notifications-vi'

/** Giả lập có trạng thái để kiểm idempotent: updateMany đổi tiêu đề thật. */
function fakeDb(titles: string[]): {
  db: NotificationsMongoDatabase
  collection: Record<string, Mock>
  rows: Array<{ title: string; body: string }>
} {
  const rows = titles.map(title => ({ title, body: 'old' }))
  const collection = {
    countDocuments: vi.fn((f: { title: string }) =>
      Promise.resolve(rows.filter(r => r.title === f.title).length)
    ),
    updateMany: vi.fn(
      (
        f: { title: string },
        u: { $set: { title: string; body: string } }
      ): Promise<{ modifiedCount: number }> => {
        const hit = rows.filter(r => r.title === f.title)
        hit.forEach(r => Object.assign(r, u.$set))
        return Promise.resolve({ modifiedCount: hit.length })
      }
    ),
  }
  const db = {
    collection: vi.fn(() => collection),
  } as unknown as NotificationsMongoDatabase
  return { db, collection, rows }
}

describe('035-move-in-overdue-notifications-vi', () => {
  it('rewrites only notifications with the exact legacy title', async () => {
    const { db, rows, collection } = fakeDb([
      'Move-in settlement overdue',
      'Move-in settlement overdue',
      'Move-in settlement overdue (copy)',
      'Khác',
    ])

    const report = await localizeMoveInOverdueNotifications(db, {
      dryRun: false,
    })

    expect(report).toMatchObject({
      scanned: 2,
      updated: 2,
      skipped: 0,
      errors: [],
    })
    expect(rows.map(r => r.title)).toEqual([
      'Quyết toán dọn nhà đã quá hạn',
      'Quyết toán dọn nhà đã quá hạn',
      'Move-in settlement overdue (copy)',
      'Khác',
    ])
    expect(rows[0]?.body).not.toMatch(/Settlement|[0-9a-f]{24}/i)
    expect(collection.updateMany).toHaveBeenCalledWith(
      { title: 'Move-in settlement overdue' },
      expect.anything()
    )
  })

  it('is idempotent on a second run', async () => {
    const { db } = fakeDb(['Move-in settlement overdue'])

    await localizeMoveInOverdueNotifications(db, { dryRun: false })
    const second = await localizeMoveInOverdueNotifications(db, {
      dryRun: false,
    })

    expect(second).toMatchObject({ scanned: 0, updated: 0 })
  })

  it('handles an empty collection', async () => {
    const { db } = fakeDb([])

    const report = await localizeMoveInOverdueNotifications(db, {
      dryRun: false,
    })

    expect(report).toMatchObject({ scanned: 0, updated: 0, skipped: 0 })
  })

  it('defaults to dry-run and writes nothing', async () => {
    const { db, collection } = fakeDb(['Move-in settlement overdue'])

    const report = await localizeMoveInOverdueNotifications(db)

    expect(report).toMatchObject({ dryRun: true, scanned: 1, updated: 0 })
    expect(collection.updateMany).not.toHaveBeenCalled()
  })

  it('rollback is a no-op', async () => {
    await expect(
      rollbackMoveInOverdueNotificationsVi({ dryRun: false })
    ).resolves.toMatchObject({
      updated: 0,
      errors: [],
    })
  })
})
