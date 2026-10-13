import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import { encrypt, keyHash } from '../utils/groq-key-crypto'
import {
  GROQ_INVALID_KEY_MESSAGE,
  probeKey,
  type CheckResult,
} from '../utils/groq-probe'
import { GroqKeysService } from './groq-keys.service'
import type { GroqApiKey } from '../schemas/groq-api-key.schema'

jest.mock('../utils/groq-probe', () => ({
  GROQ_INVALID_KEY_MESSAGE: 'Key không hợp lệ hoặc đã bị thu hồi',
  probeKey: jest.fn(),
}))

const SECRET = 'a'.repeat(32)
const RAW_KEY = 'gsk_abcdefghijklmnopqrstuvwxyz0123'
const NOW = new Date('2026-01-01T00:00:00Z').getTime()

const probeMock = probeKey as jest.MockedFunction<typeof probeKey>

function okCheck(): CheckResult {
  return { at: NOW, ok: true, models: [] }
}

function storedDoc(overrides: Partial<GroqApiKey> = {}): GroqApiKey {
  return {
    _id: new ObjectId(),
    keyEnc: encrypt(RAW_KEY, SECRET),
    keyHash: keyHash(RAW_KEY, SECRET),
    keyMask: 'gsk_abcd...0123',
    status: 'active',
    cooldownUntil: 0,
    usageCount: 0,
    failCount: 0,
    lastUsedAt: 0,
    createdAt: NOW,
    ...overrides,
  }
}

type RepoMock = Record<
  | 'findOneAndUpdate'
  | 'find'
  | 'findOneBy'
  | 'create'
  | 'insert'
  | 'updateOne'
  | 'deleteOne',
  jest.Mock
>

function callsOf(mock: jest.Mock): unknown[][] {
  return mock.mock.calls as unknown[][]
}

function createRepo(): RepoMock {
  return {
    findOneAndUpdate: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn(),
    create: jest.fn((value: object) => value),
    insert: jest.fn().mockResolvedValue(undefined),
    updateOne: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockResolvedValue(undefined),
  }
}

function createService(repo: RepoMock, secret = SECRET): GroqKeysService {
  const config = { get: jest.fn().mockReturnValue(secret) }
  return new GroqKeysService(
    repo as unknown as MongoRepository<GroqApiKey>,
    config as unknown as ConfigService
  )
}

describe('GroqKeysService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW)
    probeMock.mockReset()
  })
  afterEach(() => jest.useRealTimers())

  describe('current', () => {
    it('picks the oldest ready key, counts the issue and returns the decrypted key', async () => {
      const repo = createRepo()
      repo.findOneAndUpdate.mockResolvedValue(storedDoc())
      const service = createService(repo)

      await expect(service.current()).resolves.toBe(RAW_KEY)

      expect(repo.findOneAndUpdate).toHaveBeenCalledWith(
        { status: 'active', cooldownUntil: { $lte: NOW } },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: NOW } },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      )
    })

    it('returns null when no key is ready', async () => {
      const repo = createRepo()
      repo.findOneAndUpdate.mockResolvedValue(null)
      await expect(createService(repo).current()).resolves.toBeNull()
    })

    it('returns null without touching the DB when the secret is missing', async () => {
      const repo = createRepo()
      await expect(createService(repo, '').current()).resolves.toBeNull()
      expect(repo.findOneAndUpdate).not.toHaveBeenCalled()
    })
  })

  describe('report', () => {
    it('puts an exhausted key on the default 600s cooldown', async () => {
      const repo = createRepo()
      await createService(repo).report(RAW_KEY, 'exhausted')

      expect(repo.updateOne).toHaveBeenCalledWith(
        { keyHash: keyHash(RAW_KEY, SECRET) },
        {
          $set: { cooldownUntil: NOW + 600_000, lastError: 'Hết hạn mức' },
          $inc: { failCount: 1 },
        }
      )
    })

    it('uses retry-after as the cooldown and caps it at 7 days', async () => {
      const repo = createRepo()
      const service = createService(repo)

      await service.report(RAW_KEY, 'exhausted', 120, 'slow down')
      expect(callsOf(repo.updateOne)[0]?.[1]).toMatchObject({
        $set: { cooldownUntil: NOW + 120_000, lastError: 'slow down' },
      })

      await service.report(RAW_KEY, 'exhausted', 999_999_999)
      expect(callsOf(repo.updateOne)[1]?.[1]).toMatchObject({
        $set: { cooldownUntil: NOW + 7 * 24 * 3600 * 1000 },
      })
    })

    it('marks a rejected key as invalid', async () => {
      const repo = createRepo()
      await createService(repo).report(RAW_KEY, 'invalid', undefined, '401')

      expect(repo.updateOne).toHaveBeenCalledWith(
        { keyHash: keyHash(RAW_KEY, SECRET) },
        {
          $set: { status: 'invalid', lastError: '401' },
          $inc: { failCount: 1 },
        }
      )
    })

    it('does nothing when the secret is missing', async () => {
      const repo = createRepo()
      await createService(repo, '').report(RAW_KEY, 'invalid')
      expect(repo.updateOne).not.toHaveBeenCalled()
    })
  })

  describe('addMany', () => {
    it('counts a key already in the DB as duplicated without inserting', async () => {
      const repo = createRepo()
      repo.findOneBy.mockResolvedValueOnce({ keyHash: 'existing' })

      const result = await createService(repo).addMany([RAW_KEY])

      expect(result).toEqual({ added: 0, duplicated: 1 })
      expect(repo.insert).not.toHaveBeenCalled()
    })

    it('stores encrypted keys, dedupes within the request and counts DB duplicates', async () => {
      const repo = createRepo()
      const duplicateError = Object.assign(new Error('E11000'), { code: 11000 })
      repo.insert
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(duplicateError)

      const other = 'gsk_zyxwvutsrqponmlkjihgfedcba9876'
      const result = await createService(repo).addMany([
        RAW_KEY,
        RAW_KEY,
        other,
      ])

      expect(result).toEqual({ added: 1, duplicated: 1 })
      expect(repo.insert).toHaveBeenCalledTimes(2)
      const inserted = callsOf(repo.insert)[0]?.[0] as Record<string, unknown>
      expect(inserted).toMatchObject({
        keyHash: keyHash(RAW_KEY, SECRET),
        keyMask: 'gsk_abcd...0123',
        status: 'active',
        cooldownUntil: 0,
        createdAt: NOW,
      })
      expect(JSON.stringify(inserted)).not.toContain(RAW_KEY)
    })

    it('saves a valid probe result sent alongside the key', async () => {
      const repo = createRepo()
      const check = okCheck()
      await createService(repo).addMany([RAW_KEY], { [RAW_KEY]: check })

      expect(callsOf(repo.insert)[0]?.[0]).toMatchObject({ check })
    })

    it('ignores a malformed probe result', async () => {
      const repo = createRepo()
      const malformed = { nope: true } as unknown as CheckResult
      await createService(repo).addMany([RAW_KEY], { [RAW_KEY]: malformed })

      expect(callsOf(repo.insert)[0]?.[0]).not.toHaveProperty('check')
    })

    it('rejects more than 100 distinct keys', async () => {
      const keys = Array.from({ length: 101 }, (_, i) =>
        `gsk_${i}`.padEnd(30, 'x')
      )
      await expect(createService(createRepo()).addMany(keys)).rejects.toThrow(
        BadRequestException
      )
    })

    it('fails with 503 when the secret is missing', async () => {
      await expect(
        createService(createRepo(), '').addMany([RAW_KEY])
      ).rejects.toThrow(ServiceUnavailableException)
    })
  })

  describe('check', () => {
    it('probes a raw key without saving anything', async () => {
      const repo = createRepo()
      const result = okCheck()
      probeMock.mockResolvedValue(result)

      await expect(createService(repo).check({ key: RAW_KEY })).resolves.toBe(
        result
      )
      expect(probeMock).toHaveBeenCalledWith(RAW_KEY)
      expect(repo.updateOne).not.toHaveBeenCalled()
    })

    it('probes a saved key and stores the result', async () => {
      const repo = createRepo()
      const doc = storedDoc()
      repo.findOneBy.mockResolvedValue(doc)
      const result = okCheck()
      probeMock.mockResolvedValue(result)

      await createService(repo).check({ id: doc._id.toHexString() })

      expect(probeMock).toHaveBeenCalledWith(RAW_KEY)
      expect(repo.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        { $set: { check: result } }
      )
    })

    it('marks a saved key invalid when Groq rejects it', async () => {
      const repo = createRepo()
      const doc = storedDoc()
      repo.findOneBy.mockResolvedValue(doc)
      probeMock.mockResolvedValue({
        at: NOW,
        ok: false,
        error: GROQ_INVALID_KEY_MESSAGE,
        models: [],
      })

      await createService(repo).check({ id: doc._id.toHexString() })

      expect(callsOf(repo.updateOne)[0]?.[1]).toMatchObject({
        $set: { status: 'invalid' },
      })
    })

    it('puts a rate-limited saved key on a 10 minute cooldown', async () => {
      const repo = createRepo()
      const doc = storedDoc()
      repo.findOneBy.mockResolvedValue(doc)
      probeMock.mockResolvedValue({
        at: NOW,
        ok: true,
        models: [],
        limited: true,
      })

      await createService(repo).check({ id: doc._id.toHexString() })

      expect(callsOf(repo.updateOne)[0]?.[1]).toMatchObject({
        $set: { cooldownUntil: NOW + 600_000 },
      })
    })

    it('returns 404 for an unknown saved key', async () => {
      const repo = createRepo()
      repo.findOneBy.mockResolvedValue(null)
      await expect(
        createService(repo).check({ id: new ObjectId().toHexString() })
      ).rejects.toThrow(NotFoundException)
    })

    it('returns 400 for a malformed id', async () => {
      await expect(
        createService(createRepo()).check({ id: 'not-an-id' })
      ).rejects.toThrow(BadRequestException)
    })

    it('returns 400 when neither key nor id is given', async () => {
      await expect(createService(createRepo()).check({})).rejects.toThrow(
        BadRequestException
      )
    })
  })

  describe('setStatus', () => {
    it('disables a key', async () => {
      const repo = createRepo()
      const doc = storedDoc()
      repo.findOneBy.mockResolvedValue(doc)

      await createService(repo).setStatus(doc._id.toHexString(), 'disable')

      expect(repo.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        { $set: { status: 'disabled' } }
      )
    })

    it('enables or resets a key back to active with no cooldown', async () => {
      const repo = createRepo()
      const doc = storedDoc({ status: 'invalid', cooldownUntil: NOW + 1000 })
      repo.findOneBy.mockResolvedValue(doc)
      const service = createService(repo)

      await service.setStatus(doc._id.toHexString(), 'enable')
      await service.setStatus(doc._id.toHexString(), 'reset')

      const expected = {
        $set: { status: 'active', cooldownUntil: 0, lastError: '' },
      }
      expect(repo.updateOne).toHaveBeenNthCalledWith(
        1,
        { _id: doc._id },
        expected
      )
      expect(repo.updateOne).toHaveBeenNthCalledWith(
        2,
        { _id: doc._id },
        expected
      )
    })

    it('returns 404 for an unknown id', async () => {
      const repo = createRepo()
      repo.findOneBy.mockResolvedValue(null)
      await expect(
        createService(repo).setStatus(new ObjectId().toHexString(), 'disable')
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('remove', () => {
    it('deletes an existing key', async () => {
      const repo = createRepo()
      const doc = storedDoc()
      repo.findOneBy.mockResolvedValue(doc)

      await createService(repo).remove(doc._id.toHexString())

      expect(repo.deleteOne).toHaveBeenCalledWith({ _id: doc._id })
    })

    it('returns 404 for an unknown id', async () => {
      const repo = createRepo()
      repo.findOneBy.mockResolvedValue(null)
      await expect(
        createService(repo).remove(new ObjectId().toHexString())
      ).rejects.toThrow(NotFoundException)
    })
  })

  describe('list', () => {
    it('returns masked items without ciphertext or hash, newest first', async () => {
      const repo = createRepo()
      const doc = storedDoc({ lastError: 'boom' })
      repo.find.mockResolvedValue([doc])

      const [item] = await createService(repo).list()

      expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } })
      expect(item).toEqual({
        _id: doc._id.toHexString(),
        key: 'gsk_abcd...0123',
        status: 'active',
        cooldownUntil: 0,
        usageCount: 0,
        failCount: 0,
        lastUsedAt: 0,
        createdAt: NOW,
        lastError: 'boom',
      })
      expect(JSON.stringify(item)).not.toContain(RAW_KEY)
    })

    it('fails with 503 when the secret is missing', async () => {
      await expect(createService(createRepo(), '').list()).rejects.toThrow(
        ServiceUnavailableException
      )
    })
  })
})
