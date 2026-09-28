import {
  PLATFORM_FEE_DRAFT_SEED,
  seedPlatformFeeDraft,
} from './platform-fees.seed'

describe('platform fee draft seed', () => {
  it('is idempotent and leaves the schedule in draft', async () => {
    const repository = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ status: 'draft' }),
      create: jest.fn((value: unknown): unknown => value),
      save: jest.fn(
        (value: unknown): Promise<unknown> => Promise.resolve(value)
      ),
    }
    const first = await seedPlatformFeeDraft(repository as never)
    const second = await seedPlatformFeeDraft(repository as never)
    expect(first.status).toBe('draft')
    expect(second.status).toBe('draft')
    expect(first.rules).toEqual(PLATFORM_FEE_DRAFT_SEED)
    expect(repository.save).toHaveBeenCalledTimes(1)
  })
})
