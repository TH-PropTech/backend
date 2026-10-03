import type { Repository } from 'typeorm'
import { PlatformFeesService } from './platform-fees.service'
import type { PlatformFeeSchedule } from './schemas/platform-fee-schedule.schema'
import type { PlatformFeeAudit } from './schemas/platform-fee-audit.schema'
import type { Payment } from '../payments/schemas/payment.schema'

describe('PlatformFeesService.getEffectiveSchedule (PROP-399 governance source)', () => {
  const now = new Date('2026-10-02T00:00:00.000Z')
  function build(rows: Partial<PlatformFeeSchedule>[]): PlatformFeesService {
    const scheduleRepo = { find: jest.fn().mockResolvedValue(rows) }
    return new PlatformFeesService(
      scheduleRepo as unknown as Repository<PlatformFeeSchedule>,
      {} as unknown as Repository<PlatformFeeAudit>,
      {} as unknown as Repository<Payment>
    )
  }

  it('returns the published schedule with the latest effectiveFrom that has already started', async () => {
    const service = build([
      {
        scheduleId: 'old',
        version: 1,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        scheduleId: 'current',
        version: 2,
        effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        scheduleId: 'future',
        version: 3,
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      },
    ])
    await expect(service.getEffectiveSchedule(now)).resolves.toMatchObject({
      scheduleId: 'current',
    })
  })

  it('returns null when no published schedule is in effect', async () => {
    await expect(build([]).getEffectiveSchedule(now)).resolves.toBeNull()
    await expect(
      build([
        { scheduleId: 'future', effectiveFrom: new Date('2027-01-01') },
        { scheduleId: 'none', effectiveFrom: null },
      ]).getEffectiveSchedule(now)
    ).resolves.toBeNull()
  })
})
