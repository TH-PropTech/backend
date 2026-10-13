import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import type { GroqKeyPool } from '../../ai/services/groq-key-pool.service'
import { fetchPageHtml, SafeFetchError } from '../utils/safe-fetch'
import { distillLegalPage } from '../utils/legal-distill'
import { LegalKnowledgeService } from './legal-knowledge.service'
import type { LegalKnowledgeChunk } from '../schemas/legal-knowledge-chunk.schema'
import type { LegalKnowledgeDoc } from '../schemas/legal-knowledge-doc.schema'

jest.mock('../utils/safe-fetch', () => {
  const actual = jest.requireActual<typeof import('../utils/safe-fetch')>(
    '../utils/safe-fetch'
  )
  return { ...actual, fetchPageHtml: jest.fn() }
})
jest.mock('../utils/legal-distill', () => {
  const actual = jest.requireActual<typeof import('../utils/legal-distill')>(
    '../utils/legal-distill'
  )
  return { ...actual, distillLegalPage: jest.fn() }
})

const mockFetchPageHtml = fetchPageHtml as jest.MockedFunction<
  typeof fetchPageHtml
>
const mockDistill = distillLegalPage as jest.MockedFunction<
  typeof distillLegalPage
>

type AnyRecord = Record<string, unknown> & { _id?: ObjectId }

/** In-memory stand-in for the subset of MongoRepository the service uses. */
function fakeRepo(): {
  rows: Map<string, AnyRecord>
  repo: MongoRepository<AnyRecord>
} {
  const rows = new Map<string, AnyRecord>()
  const matches = (
    row: AnyRecord,
    where: Record<string, unknown> | undefined
  ): boolean => {
    if (!where) return true
    return Object.entries(where).every(([key, condition]) => {
      if (
        typeof condition === 'object' &&
        condition !== null &&
        '$in' in condition
      ) {
        return (condition as { $in: unknown[] }).$in.includes(row[key])
      }
      if (key === '_id' && condition instanceof ObjectId) {
        return row._id?.equals(condition) === true
      }
      return row[key] === condition
    })
  }
  const repo = {
    create: (value: AnyRecord): AnyRecord => ({ ...value }),
    insertMany: (entities: AnyRecord[]): Promise<void> => {
      for (const entity of entities) {
        const _id = new ObjectId()
        rows.set(_id.toHexString(), { ...entity, _id })
      }
      return Promise.resolve()
    },
    save: (entity: AnyRecord): Promise<AnyRecord> => {
      const _id = entity._id ?? new ObjectId()
      const saved: AnyRecord = {
        ...entity,
        _id,
        createdAt: entity['createdAt'] ?? new Date(),
        updatedAt: new Date(),
      }
      rows.set(_id.toHexString(), saved)
      return Promise.resolve(saved)
    },
    find: (options?: {
      where?: Record<string, unknown>
    }): Promise<AnyRecord[]> =>
      Promise.resolve(
        [...rows.values()].filter(row => matches(row, options?.where))
      ),
    findOneBy: (where: Record<string, unknown>): Promise<AnyRecord | null> =>
      Promise.resolve(
        [...rows.values()].find(row => matches(row, where)) ?? null
      ),
    deleteMany: (where: Record<string, unknown>): Promise<void> => {
      for (const [key, row] of rows) {
        if (matches(row, where)) rows.delete(key)
      }
      return Promise.resolve()
    },
  }
  return { rows, repo: repo as unknown as MongoRepository<AnyRecord> }
}

const LONG_BODY =
  'Điều 472. Hợp đồng thuê tài sản. Bên cho thuê phải giao tài sản đúng thỏa thuận, bên thuê đặt cọc và thanh toán tiền thuê theo kỳ.'

function createService(): {
  service: LegalKnowledgeService
  docs: Map<string, AnyRecord>
  chunks: Map<string, AnyRecord>
} {
  const docStore = fakeRepo()
  const chunkStore = fakeRepo()
  const service = new LegalKnowledgeService(
    docStore.repo as unknown as MongoRepository<LegalKnowledgeDoc>,
    chunkStore.repo as unknown as MongoRepository<LegalKnowledgeChunk>,
    {} as GroqKeyPool
  )
  return { service, docs: docStore.rows, chunks: chunkStore.rows }
}

const baseDoc = {
  title: 'Luật Nhà ở 2023',
  category: 'luat' as const,
  docNumber: '27/2023/QH15',
  content: LONG_BODY,
  keywords: ['đặt cọc', 'thuê nhà'],
}

describe('LegalKnowledgeService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates a draft, chunks its content and keeps it out of search', async () => {
    const { service, chunks } = createService()

    const detail = await service.create({ ...baseDoc, status: 'draft' })

    expect(detail.status).toBe('draft')
    expect(detail.contentSource).toBe('manual')
    expect(detail.chunkCount).toBeGreaterThan(0)
    expect(chunks.size).toBe(detail.chunkCount)
    expect(await service.search('đặt cọc thuê nhà')).toEqual([])
  })

  it('creates a link-sourced doc with fetchedAt and normalised keywords', async () => {
    const { service } = createService()

    const detail = await service.create({
      ...baseDoc,
      sourceUrl: 'https://example.gov.vn/luat',
      keywords: [' đặt cọc ', 'Đặt Cọc', '', 'thuê nhà'],
    })

    expect(detail.contentSource).toBe('link')
    expect(detail.fetchedAt).toEqual(expect.any(String))
    expect(detail.keywords).toEqual(['đặt cọc', 'thuê nhà'])
  })

  it('publishes into the index, unpublishes and archives out of it', async () => {
    const { service } = createService()
    const draft = await service.create(baseDoc)

    await service.publish(draft._id)
    const hits = await service.search('đặt cọc thuê nhà', 4)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toMatchObject({
      docId: draft._id,
      title: 'Luật Nhà ở 2023',
      docNumber: '27/2023/QH15',
    })

    await service.unpublish(draft._id)
    expect(await service.search('đặt cọc thuê nhà')).toEqual([])

    await service.publish(draft._id)
    await service.archive(draft._id)
    expect(await service.search('đặt cọc thuê nhà')).toEqual([])
  })

  it('searches only published docs', async () => {
    const { service } = createService()
    await service.create({
      ...baseDoc,
      title: 'Bản nháp đặt cọc',
      status: 'draft',
    })
    await service.create({ ...baseDoc, status: 'published' })

    const hits = await service.search('đặt cọc thuê nhà')

    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every(hit => hit.title === 'Luật Nhà ở 2023')).toBe(true)
  })

  it('lets one long doc fill only one result slot', async () => {
    const { service } = createService()
    const articles = Array.from(
      { length: 6 },
      (_, index) =>
        `Điều ${index + 1}. Đặt cọc thuê nhà số ${index + 1}\nBên thuê đặt cọc thuê nhà cho bên cho thuê theo thỏa thuận.`
    ).join('\n\n')
    await service.create({
      ...baseDoc,
      title: 'Văn bản dài',
      content: articles,
      status: 'published',
    })
    await service.create({
      ...baseDoc,
      title: 'Văn bản ngắn',
      content: 'Điều 1. Đặt cọc thuê nhà tối đa hai tháng tiền thuê nhà.',
      status: 'published',
    })

    const hits = await service.search('đặt cọc thuê nhà', 4)

    const perDoc = new Map<string, number>()
    for (const hit of hits) {
      perDoc.set(hit.docId, (perDoc.get(hit.docId) ?? 0) + 1)
    }
    expect(Math.max(...perDoc.values())).toBe(1)
    expect(hits.some(hit => hit.title === 'Văn bản ngắn')).toBe(true)
  })

  it('re-chunks and reindexes when content is updated', async () => {
    const { service, chunks } = createService()
    const doc = await service.create({ ...baseDoc, status: 'published' })
    const before = [...chunks.values()].map(chunk => chunk['text'])

    const updated = await service.update(doc._id, {
      content:
        'Điều 1. Quy định mới về bảo trì thang máy và hệ thống điện trong tòa nhà chung cư.',
    })

    expect(updated.content).toContain('bảo trì thang máy')
    const after = [...chunks.values()].map(chunk => chunk['text'])
    expect(after).not.toEqual(before)
    expect(
      after.every(text => typeof text === 'string' && !before.includes(text))
    ).toBe(true)
    expect(updated.chunkCount).toBe(chunks.size)
    // Old body text is gone from the index; the doc's own keywords still match the old phrase, so use body words only.
    expect(await service.search('bên cho thuê giao tài sản')).toEqual([])
    expect((await service.search('thang máy bảo trì')).length).toBeGreaterThan(
      0
    )
  })

  it('returns when a hit was taken from its source link', async () => {
    const { service } = createService()
    const created = await service.create({
      ...baseDoc,
      sourceUrl: 'https://example.gov.vn/luat',
      status: 'published',
    })

    const [hit] = await service.search('đặt cọc thuê nhà')

    expect(hit?.fetchedAt).toBe(created.fetchedAt)
  })

  it('stamps a new fetchedAt when link-sourced content is refreshed, not on metadata edits', async () => {
    const { service } = createService()
    const created = await service.create({
      ...baseDoc,
      sourceUrl: 'https://example.gov.vn/luat',
    })
    const firstFetch = created.fetchedAt
    await new Promise(resolve => setTimeout(resolve, 5))

    const renamed = await service.update(created._id, { issuer: 'Quốc hội' })
    expect(renamed.fetchedAt).toBe(firstFetch)

    const refreshed = await service.update(created._id, {
      content: 'Điều 1. Nội dung mới tải lại từ trang nguồn của cơ quan.',
    })
    expect(refreshed.fetchedAt).not.toBe(firstFetch)
  })

  it('leaves chunks alone when only metadata changes', async () => {
    const { service, chunks } = createService()
    const doc = await service.create(baseDoc)
    const before = [...chunks.keys()]

    await service.update(doc._id, { issuer: 'Quốc hội' })

    expect([...chunks.keys()]).toEqual(before)
  })

  it('lists with a folded text filter and category filter', async () => {
    const { service } = createService()
    await service.create(baseDoc)
    await service.create({
      ...baseDoc,
      title: 'Nội quy tòa nhà',
      category: 'noi-quy',
      keywords: [],
    })

    expect(
      (await service.list({ q: 'luat nha' })).map(item => item.title)
    ).toEqual(['Luật Nhà ở 2023'])
    expect(
      (await service.list({ category: 'noi-quy' })).map(item => item.title)
    ).toEqual(['Nội quy tòa nhà'])
  })

  it('throws 400 for a malformed id and 404 for an unknown id', async () => {
    const { service } = createService()

    await expect(service.getDetail('not-an-id')).rejects.toBeInstanceOf(
      BadRequestException
    )
    await expect(
      service.getDetail(new ObjectId().toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  describe('fetchAndDistill', () => {
    const pageHtml = `<html><head><title>Luật Nhà ở</title></head><body><article>${'<p>Điều 1. Quy định chi tiết về việc thuê nhà ở và đặt cọc theo hợp đồng.</p>'.repeat(10)}</article></body></html>`

    it('downloads, extracts and distils the page', async () => {
      const { service } = createService()
      mockFetchPageHtml.mockResolvedValue({
        finalUrl: 'https://example.gov.vn/luat-nha-o',
        html: pageHtml,
        status: 200,
      })
      mockDistill.mockResolvedValue({
        content: '# Điều 1\nNội dung đã chắt lọc',
        distilled: true,
        suggestion: { keywords: ['thuê nhà'], title: 'Luật Nhà ở' },
      })

      const result = await service.fetchAndDistill(
        'https://example.gov.vn/luat-nha-o'
      )

      expect(mockFetchPageHtml).toHaveBeenCalledWith(
        'https://example.gov.vn/luat-nha-o'
      )
      expect(mockDistill).toHaveBeenCalledWith(
        expect.objectContaining({
          pageTitle: 'Luật Nhà ở',
          url: 'https://example.gov.vn/luat-nha-o',
        }),
        expect.anything()
      )
      expect(result).toMatchObject({
        url: 'https://example.gov.vn/luat-nha-o',
        finalUrl: 'https://example.gov.vn/luat-nha-o',
        pageTitle: 'Luật Nhà ở',
        distilled: true,
        content: '# Điều 1\nNội dung đã chắt lọc',
      })
      expect(result.rawCharCount).toBeGreaterThanOrEqual(200)
    })

    it('asks the admin to paste manually when the page has too little text', async () => {
      const { service } = createService()
      mockFetchPageHtml.mockResolvedValue({
        finalUrl: 'https://example.gov.vn/app',
        html: '<html><body><div id="root"></div><script>render()</script></body></html>',
        status: 200,
      })

      const error = await service
        .fetchAndDistill('https://example.gov.vn/app')
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).message).toContain(
        'hãy dán nội dung thủ công'
      )
      expect(mockDistill).not.toHaveBeenCalled()
    })

    it.each([
      ['BLOCKED', BadRequestException],
      ['BAD_TYPE', BadRequestException],
      ['TOO_LARGE', BadRequestException],
      ['HTTP', BadRequestException],
      ['TIMEOUT', BadGatewayException],
      ['NETWORK', BadGatewayException],
    ] as const)(
      'maps SafeFetchError %s to the right HTTP error',
      async (code, expected) => {
        const { service } = createService()
        mockFetchPageHtml.mockRejectedValue(
          new SafeFetchError('boom', code, 503)
        )

        const error = await service
          .fetchAndDistill('https://example.gov.vn/x')
          .catch((e: unknown) => e)

        expect(error).toBeInstanceOf(expected)
      }
    )

    it('rethrows unknown errors unchanged', async () => {
      const { service } = createService()
      const original = new Error('unexpected')
      mockFetchPageHtml.mockRejectedValue(original)

      await expect(
        service.fetchAndDistill('https://example.gov.vn/x')
      ).rejects.toBe(original)
    })
  })
})
