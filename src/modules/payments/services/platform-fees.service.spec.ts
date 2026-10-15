import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { PlatformFeesService } from './platform-fees.service'
import type {
  PlatformFeeScheduleRepository,
  PlatformFeeScheduleView,
} from '../utils/platform-fee-schedule.repository'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import type { Payment } from '../schemas/payment.schema'
import type { PlatformFeeScheduleRules } from '../utils/platform-fee.types'
import * as feeRulesValidator from '../utils/fee-rules.validator'

describe('PlatformFeesService.getEffectiveSchedule (PROP-399 governance source)', () => {
  const now = new Date('2026-10-02T00:00:00.000Z')
  function build(
    rows: Partial<PlatformFeeScheduleView>[]
  ): PlatformFeesService {
    const scheduleRepo = { find: jest.fn().mockResolvedValue(rows) }
    return new PlatformFeesService(
      scheduleRepo as unknown as PlatformFeeScheduleRepository,
      {} as unknown as ConfigAuditService,
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

describe('PlatformFeesService audit writes (characterization)', () => {
  it('appends an audit row for a saved draft and for an archive', async () => {
    const created: Record<string, unknown>[] = []
    const auditRepo = {
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: Record<string, unknown>) => {
        created.push(v)
        return Promise.resolve(v)
      }),
    }
    const scheduleRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    }
    const service = new PlatformFeesService(
      scheduleRepo as unknown as PlatformFeeScheduleRepository,
      new ConfigAuditService(auditRepo as unknown as Repository<ActivityLog>),
      {} as unknown as Repository<Payment>
    )
    const rules = {
      transactionTypes: {},
    } as unknown as PlatformFeeScheduleRules
    jest.spyOn(feeRulesValidator, 'validateFeeRules').mockReturnValue([])

    await service.saveDraft(
      { scheduleId: 'fee-1', rules, reason: 'init' },
      'admin-1'
    )
    scheduleRepo.findOne.mockResolvedValue({
      scheduleId: 'fee-1',
      version: 1,
      contentHash: 'h',
    })
    await service.archive('fee-1', 1, 'admin-2', 'retire')

    expect(created).toHaveLength(2)
    expect(created[0]).toEqual(
      expect.objectContaining({
        kind: 'config-audit',
        scope: 'platform-fee',
        key: 'fee-1',
        version: 1,
        action: 'draft-saved',
        actorId: 'admin-1',
        reason: 'init',
        details: {
          changedFields: ['rules', 'legalReviewStatus', 'reviewReference'],
        },
        beforeHash: null,
      })
    )
    expect(created[1]).toEqual({
      kind: 'config-audit',
      scope: 'platform-fee',
      key: 'fee-1',
      version: 1,
      action: 'archived',
      actorId: 'admin-2',
      reason: 'retire',
      details: { changedFields: ['status'] },
      beforeHash: 'h',
      afterHash: 'h',
    })
  })
})
