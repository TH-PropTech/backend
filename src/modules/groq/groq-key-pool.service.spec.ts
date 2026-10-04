import type { ConfigService } from '@nestjs/config'
import { GroqKeyPool } from './groq-key-pool.service'

function createPool(keys: string[]): GroqKeyPool {
  const config = { get: jest.fn().mockReturnValue(keys) }
  return new GroqKeyPool(config as unknown as ConfigService)
}

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
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
})
