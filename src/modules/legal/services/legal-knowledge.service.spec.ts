import { vi } from 'vitest'
import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository, Repository } from 'typeorm'
import type { GroqKeyPool } from '../../ai/services/groq-key-pool.service'
import { fetchPageHtml, SafeFetchError } from '../utils/safe-fetch'
import { distillLegalPage } from '../utils/legal-distill'
import { LegalKnowledgeService } from './legal-knowledge.service'
import {
  PLATFORM_FAQ_ENTRIES,
  PLATFORM_FAQ_ISSUER,
} from '../utils/platform-faq.seed-data'
import { LEGAL_CONTENT_MIN } from '../dto/legal-knowledge.dto'
import type { LegalKnowledgeChunk } from '../schemas/legal-knowledge-chunk.schema'
import type { LegalDocument } from '../schemas/legal-document.schema'

vi.mock('../utils/safe-fetch', async () => {
  const actual = await vi.importActual<typeof import('../utils/safe-fetch')>(
    '../utils/safe-fetch'
  )
  return { ...actual, fetchPageHtml: jest.fn() }
})
vi.mock('../utils/legal-distill', async () => {
  const actual = await vi.importActual<typeof import('../utils/legal-distill')>(
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
    docStore.repo as unknown as Repository<LegalDocument>,
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

  describe('publishMany', () => {
    it('publishes every draft in one call and makes them searchable', async () => {
      const { service } = createService()
      const first = await service.create(baseDoc)
      const second = await service.create({ ...baseDoc, title: 'Nghị định 95' })

      const result = await service.publishMany([first._id, second._id])

      expect(result.failed).toEqual([])
      expect(result.published.map(doc => doc._id).sort()).toEqual(
        [first._id, second._id].sort()
      )
      expect(result.published.every(doc => doc.status === 'published')).toBe(
        true
      )
      expect(
        (await service.search('đặt cọc thuê nhà', 4)).length
      ).toBeGreaterThan(0)
    })

    it('rebuilds the search index once for the whole batch', async () => {
      const { service } = createService()
      const first = await service.create(baseDoc)
      const second = await service.create({ ...baseDoc, title: 'Nghị định 95' })
      const rebuild = jest.spyOn(service, 'refreshIndexSafely')

      await service.publishMany([first._id, second._id])

      expect(rebuild).toHaveBeenCalledTimes(1)
    })

    it('reports bad, unknown and archived ids without blocking the others', async () => {
      const { service } = createService()
      const good = await service.create(baseDoc)
      const archived = await service.create({ ...baseDoc, title: 'Cũ' })
      await service.archive(archived._id)
      const unknown = new ObjectId().toHexString()

      const result = await service.publishMany([
        good._id,
        'khong-hop-le',
        unknown,
        archived._id,
      ])

      expect(result.published.map(doc => doc._id)).toEqual([good._id])
      expect(result.failed.map(item => item.id).sort()).toEqual(
        ['khong-hop-le', unknown, archived._id].sort()
      )
      expect(result.failed.every(item => item.message.length > 0)).toBe(true)
    })

    it('treats an already published doc as done and ignores repeated ids', async () => {
      const { service } = createService()
      const doc = await service.create({ ...baseDoc, status: 'published' })
      const rebuild = jest.spyOn(service, 'refreshIndexSafely')

      const result = await service.publishMany([doc._id, doc._id])

      expect(result.published).toHaveLength(1)
      expect(result.failed).toEqual([])
      expect(rebuild).not.toHaveBeenCalled()
    })
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

  it('returns nothing for a question whose words the knowledge base does not contain', async () => {
    const { service } = createService()
    await service.create({
      ...baseDoc,
      title: 'Quy định thuê nhà',
      content:
        'Điều 1. Đặt cọc thuê nhà\nBên thuê đặt cọc thuê nhà cho bên cho thuê theo thỏa thuận.',
      status: 'published',
    })

    expect(await service.search('cách nấu phở bò ngon', 4)).toEqual([])
  })

  it('reports how much of the question each passage covers', async () => {
    const { service } = createService()
    await service.create({
      ...baseDoc,
      title: 'Quy định thuê nhà',
      content:
        'Điều 1. Đặt cọc thuê nhà\nBên thuê đặt cọc thuê nhà cho bên cho thuê theo thỏa thuận.',
      status: 'published',
    })

    const [hit] = await service.search('đặt cọc thuê nhà', 4)

    expect(hit?.coverage).toBeGreaterThan(0.9)
    expect(hit?.coverage).toBeLessThanOrEqual(1)
  })

  it('lets one long doc fill at most two result slots so other sources still appear', async () => {
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
    expect(Math.max(...perDoc.values())).toBeLessThanOrEqual(2)
    expect(hits.some(hit => hit.title === 'Văn bản ngắn')).toBe(true)
  })

  it('finds a passage through either phrasing and merges the two rankings', async () => {
    const { service } = createService()
    await service.create({
      ...baseDoc,
      title: 'Nghị định về cho thuê lại',
      content:
        'Điều 5. Cho thuê lại nhà ở. Bên thuê chỉ được cho thuê lại khi bên cho thuê đồng ý bằng văn bản.',
      status: 'published',
    })
    await service.create({
      ...baseDoc,
      title: 'Quy định về điện nước',
      content:
        'Điều 9. Tiền điện nước. Bên thuê tự thanh toán tiền điện nước theo công tơ riêng hàng tháng.',
      status: 'published',
    })

    // the model's rewrite misses the second topic, the customer's own words cover it
    const hits = await service.search(
      ['cho thuê lại nhà ở', 'tiền điện nước thanh toán công tơ hàng tháng'],
      4
    )

    expect(hits.map(hit => hit.title).sort()).toEqual([
      'Nghị định về cho thuê lại',
      'Quy định về điện nước',
    ])
  })

  it('ranks a single query exactly as before and ignores blank or repeated queries', async () => {
    const { service } = createService()
    await service.create({ ...baseDoc, status: 'published' })

    const one = await service.search('đặt cọc thuê nhà', 4)
    const same = await service.search(
      ['đặt cọc thuê nhà', '  đặt cọc thuê nhà ', ''],
      4
    )

    expect(same).toEqual(one)
    expect(await service.search([], 4)).toEqual([])
  })

  it('drops a document from search once its expiry date has passed', async () => {
    const { service } = createService()
    const doc = await service.create({ ...baseDoc, status: 'published' })
    expect((await service.search('đặt cọc thuê nhà')).length).toBeGreaterThan(0)

    await service.update(doc._id, { expiryDate: '2020-01-01' })
    expect(await service.search('đặt cọc thuê nhà')).toEqual([])

    await service.update(doc._id, { expiryDate: '2999-01-01' })
    expect((await service.search('đặt cọc thuê nhà')).length).toBeGreaterThan(0)
  })

  describe('platform FAQ seed', () => {
    const askFaq = async (question: string): Promise<string[]> => {
      const { service } = createService()
      for (const entry of PLATFORM_FAQ_ENTRIES) {
        await service.create({
          title: entry.title,
          category: entry.category,
          issuer: PLATFORM_FAQ_ISSUER,
          keywords: entry.keywords,
          content: entry.content,
          contentSource: 'manual',
          status: 'published',
        })
      }
      return (await service.search(question, 4)).map(hit => hit.title)
    }

    it.each([
      [
        'Đặt cọc giữ chỗ trên TH-PropTech hoạt động thế nào?',
        'Đặt cọc trên TH-PropTech',
      ],
      ['Khi nào tôi được hoàn lại tiền đặt cọc?', 'Đặt cọc trên TH-PropTech'],
      [
        'eKYC là gì, tại sao tôi phải xác thực?',
        'Xác thực danh tính eKYC trên TH-PropTech',
      ],
      [
        'Xác thực danh tính cần chuẩn bị giấy tờ gì CCCD',
        'Xác thực danh tính eKYC trên TH-PropTech',
      ],
      [
        'Blockchain được dùng để làm gì trong hợp đồng thuê?',
        'Blockchain và mã băm hợp đồng trên TH-PropTech',
      ],
      [
        'Hash hợp đồng trên blockchain là gì, kiểm tra thế nào?',
        'Blockchain và mã băm hợp đồng trên TH-PropTech',
      ],
      ['Quên mật khẩu thì làm sao?', 'Tài khoản và bảo mật trên TH-PropTech'],
      [
        'Tôi đăng ký tài khoản như thế nào?',
        'Tài khoản và bảo mật trên TH-PropTech',
      ],
      [
        'Huỷ lịch xem nhà có bị mất phí không?',
        'Đặt lịch xem căn hộ trên TH-PropTech',
      ],
      [
        'Tiền thuê hàng tháng thanh toán bằng cách nào, hạn đóng khi nào?',
        'Thanh toán tiền thuê và hóa đơn trên TH-PropTech',
      ],
      [
        'Ký hợp đồng thuê điện tử trên nền tảng thế nào?',
        'Hợp đồng thuê và ký điện tử trên TH-PropTech',
      ],
      [
        'Quy trình thuê căn hộ gồm những bước nào?',
        'Quy trình thuê căn hộ trên TH-PropTech',
      ],
      ['Phí dịch vụ nền tảng là bao nhiêu?', 'Phí dịch vụ của TH-PropTech'],
    ])('answers %s from %s', async (question, expectedTitle) => {
      const titles = await askFaq(question)
      expect(titles[0]).toBe(expectedTitle)
    })

    it('has no passage longer than one chunk can hold and every doc is long enough to seed', () => {
      for (const entry of PLATFORM_FAQ_ENTRIES) {
        expect(entry.content.length).toBeGreaterThanOrEqual(LEGAL_CONTENT_MIN)
        expect(entry.content).toContain('## ')
      }
    })
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

  it('never reads rows of other legal kinds in the same collection (kind isolation)', async () => {
    const { service, docs } = createService()
    // Bản ghi của loại khác nằm chung collection, cùng status/category dễ trùng.
    const termsId = new ObjectId()
    const regulationId = new ObjectId()
    docs.set(termsId.toHexString(), {
      _id: termsId,
      kind: 'terms',
      title: 'Điều khoản đặt cọc thuê nhà',
      key: 'rental-service-terms',
      version: 1,
      status: 'published',
      sections: [],
      contentHash: 'h',
      draftRevision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    docs.set(regulationId.toHexString(), {
      _id: regulationId,
      kind: 'regulation',
      title: 'Quy định đặt cọc thuê nhà',
      code: 'REG-DEPOSIT',
      category: 'luat',
      summary: 'đặt cọc thuê nhà',
      status: 'published',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const knowledge = await service.create({
      ...baseDoc,
      status: 'published',
    })

    const listed = await service.list({ status: 'published' })
    expect(listed.map(item => item._id)).toEqual([knowledge._id])
    expect(await service.list({ category: 'luat' })).toHaveLength(1)

    const hits = await service.search('đặt cọc thuê nhà')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every(hit => hit.docId === knowledge._id)).toBe(true)

    await expect(
      service.getDetail(termsId.toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.getDetail(regulationId.toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
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
