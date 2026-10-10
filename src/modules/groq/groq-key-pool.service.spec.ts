import type { ConfigService } from '@nestjs/config'
import { GroqKeyPool } from './groq-key-pool.service'
import type { GroqKeyStore } from './groq-key-store'

function createPool(keys: string[], store?: GroqKeyStore): GroqKeyPool {
  const config = { get: jest.fn().mockReturnValue(keys) }
  return new GroqKeyPool(config as unknown as ConfigService, store)
}

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
}

/** Store that serves `ready` keys in order and drops a key once it is reported. */
interface FakeStore {
  isEnabled: jest.Mock
  current: jest.Mock
  report: jest.Mock
}

function createStore(ready: string[], enabled = true): FakeStore {
  const pending = [...ready]
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    current: jest
      .fn()
      .mockImplementation(() => Promise.resolve(pending[0] ?? null)),
    report: jest.fn().mockImplementation((key: string) => {
      const index = pending.indexOf(key)
      if (index >= 0) pending.splice(index, 1)
      return Promise.resolve()
    }),
  }
}

describe('GroqKeyPool', () => {
  afterEach(() => jest.useRealTimers())

  it('reports whether any key is configured', () => {
    expect(createPool([]).hasKeys()).toBe(false)
    expect(createPool(['a']).hasKeys()).toBe(true)
  })

  it('uses the first key while it works', async () => {
    const request = jest.fn().mockResolvedValue(res(200))
    await createPool(['a', 'b']).run('m', request)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('a')
  })

  it('moves to the next key on 429 and remembers the cooldown', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(res(429, { 'retry-after': '30' }))
      .mockResolvedValue(res(200))
    const pool = createPool(['a', 'b'])

    expect((await pool.run('m', request)).status).toBe(200)
    expect(request.mock.calls.map((args: unknown[]) => args[0])).toEqual([
      'a',
      'b',
    ])

    await pool.run('m', request)
    expect(request.mock.calls.map((args: unknown[]) => args[0])).toEqual([
      'a',
      'b',
      'b',
    ])
  })

  it('retries a key once its cooldown has passed', async () => {
    jest.useFakeTimers()
    const request = jest
      .fn()
      .mockResolvedValueOnce(res(429, { 'retry-after': '30' }))
      .mockResolvedValue(res(200))
    const pool = createPool(['a', 'b'])
    await pool.run('m', request)

    jest.advanceTimersByTime(31_000)
    await pool.run('m', request)
    expect(request).toHaveBeenLastCalledWith('a')
  })

  it('tracks cooldowns per model', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(res(429, { 'retry-after': '30' }))
      .mockResolvedValue(res(200))
    const pool = createPool(['a', 'b'])
    await pool.run('chat', request)
    await pool.run('vision', request)
    expect(request).toHaveBeenLastCalledWith('a')
  })

  it('skips a rejected key (401)', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValue(res(200))
    expect((await createPool(['a', 'b']).run('m', request)).status).toBe(200)
  })

  it('does not rotate on server errors', async () => {
    const request = jest.fn().mockResolvedValue(res(500))
    expect((await createPool(['a', 'b']).run('m', request)).status).toBe(500)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('returns a 429 when every key is exhausted without calling again', async () => {
    const request = jest
      .fn()
      .mockImplementation(() => Promise.resolve(res(429)))
    const pool = createPool(['a', 'b'])

    expect((await pool.run('m', request)).status).toBe(429)
    expect(request).toHaveBeenCalledTimes(2)
    expect((await pool.run('m', request)).status).toBe(429)
    expect(request).toHaveBeenCalledTimes(2)
  })

  describe('with key store', () => {
    it('counts the store as a key source', () => {
      expect(createPool([], createStore(['s1'])).hasKeys()).toBe(true)
      expect(createPool([], createStore(['s1'], false)).hasKeys()).toBe(false)
    })

    it('uses the store key and caches it across runs', async () => {
      const store = createStore(['s1'])
      const request = jest.fn().mockResolvedValue(res(200))
      const pool = createPool(['local'], store)

      await pool.run('m', request)
      await pool.run('m', request)

      expect(store.current).toHaveBeenCalledTimes(1)
      expect(request.mock.calls.map((args: unknown[]) => args[0])).toEqual([
        's1',
        's1',
      ])
    })

    it('refetches the store key after the cache expires', async () => {
      jest.useFakeTimers()
      try {
        const store = createStore(['s1'])
        const request = jest.fn().mockResolvedValue(res(200))
        const pool = createPool([], store)

        await pool.run('m', request)
        jest.advanceTimersByTime(30_000)
        await pool.run('m', request)
        expect(store.current).toHaveBeenCalledTimes(1)

        jest.advanceTimersByTime(31_000)
        await pool.run('m', request)
        expect(store.current).toHaveBeenCalledTimes(2)
      } finally {
        jest.useRealTimers()
      }
    })

    it('ignores the store when it is disabled', async () => {
      const store = createStore(['s1'], false)
      const request = jest.fn().mockResolvedValue(res(200))

      await createPool(['local'], store).run('m', request)

      expect(store.current).not.toHaveBeenCalled()
      expect(request).toHaveBeenCalledWith('local')
    })

    it('reports 429 as exhausted with retry-after, then uses the next store key', async () => {
      const store = createStore(['s1', 's2'])
      const request = jest
        .fn()
        .mockResolvedValueOnce(res(429, { 'retry-after': '120' }))
        .mockResolvedValue(res(200))
      const pool = createPool([], store)

      expect((await pool.run('m', request)).status).toBe(200)
      expect(request.mock.calls.map((args: unknown[]) => args[0])).toEqual([
        's1',
        's2',
      ])
      expect(store.report).toHaveBeenCalledWith(
        's1',
        'exhausted',
        120,
        expect.any(String)
      )

      await pool.run('m', request)
      expect(request).toHaveBeenLastCalledWith('s2')
    })

    it('reports 401 as invalid and rotates', async () => {
      const store = createStore(['s1', 's2'])
      const request = jest
        .fn()
        .mockResolvedValueOnce(res(401))
        .mockResolvedValue(res(200))

      await createPool([], store).run('m', request)

      expect(store.report).toHaveBeenCalledWith(
        's1',
        'invalid',
        undefined,
        expect.any(String)
      )
      expect(request).toHaveBeenLastCalledWith('s2')
    })

    it('stops after MAX_ROTATIONS and returns the last response', async () => {
      const store = createStore(['s1', 's2', 's3', 's4', 's5'])
      const request = jest
        .fn()
        .mockImplementation(() => Promise.resolve(res(429)))

      expect((await createPool([], store).run('m', request)).status).toBe(429)
      expect(request).toHaveBeenCalledTimes(4)
    })

    it('does not rotate on server errors', async () => {
      const store = createStore(['s1', 's2'])
      const request = jest.fn().mockResolvedValue(res(500))

      expect((await createPool([], store).run('m', request)).status).toBe(500)
      expect(request).toHaveBeenCalledTimes(1)
      expect(store.report).not.toHaveBeenCalled()
    })

    it('falls back to local keys when the store has no ready key', async () => {
      const store = createStore([])
      const request = jest.fn().mockResolvedValue(res(200))

      await createPool(['local'], store).run('m', request)

      expect(store.current).toHaveBeenCalledTimes(1)
      expect(request).toHaveBeenCalledWith('local')
    })

    it('falls back to local keys when the store throws', async () => {
      const store = createStore(['s1'])
      store.current.mockRejectedValue(new Error('db down'))
      const request = jest.fn().mockResolvedValue(res(200))

      await createPool(['local'], store).run('m', request)

      expect(request).toHaveBeenCalledWith('local')
    })

    it('rethrows the store error when no local key exists', async () => {
      const store = createStore(['s1'])
      store.current.mockRejectedValue(new Error('db down'))
      const request = jest.fn().mockResolvedValue(res(200))

      await expect(createPool([], store).run('m', request)).rejects.toThrow(
        'db down'
      )
      expect(request).not.toHaveBeenCalled()
    })

    it('reports a failed key only once when concurrent requests hit it', async () => {
      const store = createStore(['s1', 's2'])
      const request = jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(key === 's1' ? res(429) : res(200))
        )
      const pool = createPool([], store)

      const responses = await Promise.all([
        pool.run('m', request),
        pool.run('m', request),
      ])

      expect(responses.map(r => r.status)).toEqual([200, 200])
      expect(store.report).toHaveBeenCalledTimes(1)
      expect(store.report).toHaveBeenCalledWith(
        's1',
        'exhausted',
        undefined,
        expect.any(String)
      )
    })
  })
})
