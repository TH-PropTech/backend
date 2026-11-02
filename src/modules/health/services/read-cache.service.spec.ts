import { ConfigService } from '@nestjs/config'
import { ReadCacheService } from './read-cache.service'
import type { RedisService } from './redis.service'

class FakeRedis {
  readonly store = new Map<string, string>()
  failing = false
  readonly ttls: number[] = []

  get = vi.fn((key: string): Promise<string | null> => {
    if (this.failing) return Promise.reject(new Error('redis down'))
    return Promise.resolve(this.store.get(key) ?? null)
  })

  set = vi.fn((key: string, value: string, ttl?: number): Promise<void> => {
    if (this.failing) return Promise.reject(new Error('redis down'))
    this.store.set(key, value)
    if (ttl !== undefined) this.ttls.push(ttl)
    return Promise.resolve()
  })

  incr = vi.fn((key: string): Promise<number> => {
    if (this.failing) return Promise.reject(new Error('redis down'))
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return Promise.resolve(next)
  })

  getClient(): { incr: FakeRedis['incr'] } {
    return { incr: this.incr }
  }
}

function build(): { redis: FakeRedis; service: ReadCacheService } {
  const redis = new FakeRedis()
  const config = {
    getOrThrow: vi.fn(() => 30),
  } as unknown as ConfigService
  const service = new ReadCacheService(redis as unknown as RedisService, config)
  return { redis, service }
}

describe('ReadCacheService', () => {
  it('serves the second identical request from cache', async () => {
    const { service } = build()
    const loader = vi.fn(() => Promise.resolve({ items: [1, 2, 3] }))

    const first = await service.wrap('apartments', { city: 'hcm' }, loader)
    const second = await service.wrap('apartments', { city: 'hcm' }, loader)

    expect(first).toEqual({ items: [1, 2, 3] })
    expect(second).toEqual(first)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('uses the same key regardless of parameter order', async () => {
    const { service } = build()
    const loader = vi.fn(() => Promise.resolve('value'))

    await service.wrap('apartments', { a: 1, b: 2 }, loader)
    await service.wrap('apartments', { b: 2, a: 1 }, loader)

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('treats undefined parameters as absent', async () => {
    const { service } = build()
    const loader = vi.fn(() => Promise.resolve('value'))

    await service.wrap('apartments', { a: 1, b: undefined }, loader)
    await service.wrap('apartments', { a: 1 }, loader)

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('runs the loader once for 50 concurrent requests on the same key', async () => {
    const { service } = build()
    const loader = vi.fn(
      () =>
        new Promise<string>(resolve => setTimeout(() => resolve('shared'), 10))
    )

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        service.wrap('apartments', { page: 1 }, loader)
      )
    )

    expect(results.every(result => result === 'shared')).toBe(true)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('stops using old keys after invalidate', async () => {
    const { service } = build()
    const loader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new')

    const before = await service.wrap('apartments', { id: 'x' }, loader)
    await service.invalidate('apartments')
    const after = await service.wrap('apartments', { id: 'x' }, loader)

    expect(before).toBe('old')
    expect(after).toBe('new')
  })

  it('does not invalidate other namespaces', async () => {
    const { service } = build()
    const loader = vi.fn(() => Promise.resolve('projects'))

    await service.wrap('projects', {}, loader)
    await service.invalidate('apartments')
    await service.wrap('projects', {}, loader)

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('falls back to the loader when Redis fails', async () => {
    const { redis, service } = build()
    redis.failing = true
    const loader = vi.fn(() => Promise.resolve('from-db'))

    const value = await service.wrap('apartments', {}, loader)

    expect(value).toBe('from-db')
    await expect(service.invalidate('apartments')).resolves.toBeUndefined()
  })

  it('does not cache loader errors', async () => {
    const { service } = build()
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce('ok')

    await expect(service.wrap('apartments', {}, loader)).rejects.toThrow(
      'db error'
    )
    await expect(service.wrap('apartments', {}, loader)).resolves.toBe('ok')
  })

  it('adds up to 10% jitter to the TTL', async () => {
    const { redis, service } = build()

    await service.wrap('apartments', { k: 1 }, () => Promise.resolve('v'), 100)

    expect(redis.ttls[0]).toBeGreaterThanOrEqual(100)
    expect(redis.ttls[0]).toBeLessThanOrEqual(110)
  })

  describe('when Redis fails', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('skips Redis for the cooldown so later requests do not wait on timeouts', async () => {
      vi.useFakeTimers()
      const { redis, service } = build()
      redis.failing = true
      const loader = vi.fn(() => Promise.resolve('from-db'))

      await service.wrap('apartments', { page: 1 }, loader)
      const callsAfterFailure = redis.get.mock.calls.length
      await service.wrap('apartments', { page: 2 }, loader)
      await service.wrap('apartments', { page: 3 }, loader)

      expect(redis.get.mock.calls.length).toBe(callsAfterFailure)
      expect(loader).toHaveBeenCalledTimes(3)
    })

    it('uses Redis again after the cooldown', async () => {
      vi.useFakeTimers()
      const { redis, service } = build()
      redis.failing = true
      await service.wrap('apartments', {}, () => Promise.resolve('x'))
      redis.failing = false
      vi.advanceTimersByTime(11_000)
      const loader = vi.fn(() => Promise.resolve('cached-now'))

      await service.wrap('apartments', { again: true }, loader)
      await service.wrap('apartments', { again: true }, loader)

      expect(loader).toHaveBeenCalledTimes(1)
    })
  })
})
