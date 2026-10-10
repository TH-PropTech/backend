import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { FindOptionsWhere, MongoRepository } from 'typeorm'
import { GroqKeyPool } from '../groq/groq-key-pool.service'
import {
  normalizeKeywords,
  type CreateLegalDocDto,
  type UpdateLegalDocDto,
} from './dto/legal-knowledge.dto'
import type {
  FetchLegalLinkResult,
  LegalDocDetail,
  LegalDocItem,
} from './dto/legal-knowledge-response'
import { Bm25Index, type Bm25Doc } from './legal-bm25'
import { chunkLegalText } from './legal-chunker'
import type { LegalChunkDraft } from './legal-knowledge.types'
import type {
  LegalDocCategory,
  LegalDocStatus,
  LegalKnowledgeSearcher,
  LegalSearchHit,
} from './legal-knowledge.types'
import { distillLegalPage } from './legal-distill'
import { extractMainText } from './html-extract'
import { foldVietnamese } from './legal-text'
import { fetchPageHtml, SafeFetchError } from './safe-fetch'
import { LegalKnowledgeChunk } from './schemas/legal-knowledge-chunk.schema'
import { LegalKnowledgeDoc } from './schemas/legal-knowledge-doc.schema'

const DEFAULT_SEARCH_LIMIT = 4
/** BM25 score floor; keyword-boosted hits are at least +2 so they always pass. */
const SEARCH_MIN_SCORE = 0.5
const HIT_TEXT_MAX = 1500
/** Below this many extracted characters the page is assumed to be JS-rendered or blocking bots. */
const MIN_EXTRACTED_CHARS = 200
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/
const SHORT_TEXT_MESSAGE =
  'Trang tải nội dung bằng JavaScript hoặc chặn truy cập — hãy dán nội dung thủ công'

export interface LegalDocListFilters {
  status?: LegalDocStatus
  category?: LegalDocCategory
  q?: string
}

/** Metadata stored with each BM25 entry (one per chunk of a published doc). */
interface IndexedChunkMeta {
  docId: string
  title: string
  docNumber?: string | undefined
  issuer?: string | undefined
  sourceUrl?: string | undefined
  heading?: string | undefined
  text: string
}

/**
 * Admin-managed legal knowledge texts. Only PUBLISHED docs are indexed and
 * searchable; the chat bot uses this service through LEGAL_KNOWLEDGE_SEARCH.
 */
@Injectable()
export class LegalKnowledgeService
  implements LegalKnowledgeSearcher, OnModuleInit
{
  private readonly logger = new Logger(LegalKnowledgeService.name)
  private readonly index = new Bm25Index<IndexedChunkMeta>()

  constructor(
    @InjectRepository(LegalKnowledgeDoc)
    private readonly docRepo: MongoRepository<LegalKnowledgeDoc>,
    @InjectRepository(LegalKnowledgeChunk)
    private readonly chunkRepo: MongoRepository<LegalKnowledgeChunk>,
    private readonly groqKeyPool: GroqKeyPool
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshIndexSafely()
  }

  async list(filters: LegalDocListFilters = {}): Promise<LegalDocItem[]> {
    const where: Record<string, unknown> = {}
    if (filters.status) where['status'] = filters.status
    if (filters.category) where['category'] = filters.category

    const docs = await this.docRepo.find({
      where: where as FindOptionsWhere<LegalKnowledgeDoc>,
      order: { createdAt: 'DESC' },
    })
    // Mongo array `where` is unsupported and the text filter needs Vietnamese folding, so q is applied in memory.
    const needle = filters.q ? foldVietnamese(filters.q) : ''
    const matched = needle
      ? docs.filter(doc =>
          [doc.title, doc.docNumber ?? '', ...(doc.keywords ?? [])].some(
            value => foldVietnamese(value).includes(needle)
          )
        )
      : docs
    return matched.map(doc => toItem(doc))
  }

  async getDetail(id: string): Promise<LegalDocDetail> {
    return toDetail(await this.findById(id))
  }

  async create(
    dto: CreateLegalDocDto,
    actorId?: string
  ): Promise<LegalDocDetail> {
    const contentSource =
      dto.contentSource ?? (dto.sourceUrl ? 'link' : 'manual')
    const chunks = chunkLegalText(dto.content)
    const entity = this.docRepo.create({
      title: dto.title,
      category: dto.category,
      docNumber: emptyToUndefined(dto.docNumber),
      issuer: emptyToUndefined(dto.issuer),
      sourceUrl: emptyToUndefined(dto.sourceUrl),
      keywords: normalizeKeywords(dto.keywords),
      content: dto.content,
      summary: emptyToUndefined(dto.summary),
      contentSource,
      fetchedAt: contentSource === 'link' ? new Date() : undefined,
      effectiveDate: toDate(dto.effectiveDate),
      status: dto.status ?? 'draft',
      chunkCount: chunks.length,
      createdBy: actorId,
    })
    const saved = await this.docRepo.save(entity)
    await this.writeChunks(saved._id.toHexString(), chunks)
    if (saved.status === 'published') await this.refreshIndexSafely()
    return this.getDetail(saved._id.toHexString())
  }

  async update(id: string, dto: UpdateLegalDocDto): Promise<LegalDocDetail> {
    const doc = await this.findById(id)
    const wasPublished = doc.status === 'published'
    const contentChanged =
      dto.content !== undefined && dto.content !== doc.content

    if (dto.title !== undefined) doc.title = dto.title
    if (dto.category !== undefined) doc.category = dto.category
    if (dto.docNumber !== undefined)
      doc.docNumber = emptyToUndefined(dto.docNumber)
    if (dto.issuer !== undefined) doc.issuer = emptyToUndefined(dto.issuer)
    if (dto.sourceUrl !== undefined) {
      doc.sourceUrl = emptyToUndefined(dto.sourceUrl)
    }
    if (dto.keywords !== undefined)
      doc.keywords = normalizeKeywords(dto.keywords)
    if (dto.summary !== undefined) doc.summary = emptyToUndefined(dto.summary)
    if (dto.effectiveDate !== undefined) {
      doc.effectiveDate = toDate(dto.effectiveDate)
    }
    if (dto.contentSource !== undefined) doc.contentSource = dto.contentSource
    if (dto.status !== undefined) doc.status = dto.status

    const chunks = contentChanged
      ? chunkLegalText(dto.content ?? '')
      : undefined
    if (dto.content !== undefined) doc.content = dto.content
    if (chunks) doc.chunkCount = chunks.length

    const saved = await this.docRepo.save(doc)
    if (chunks) await this.writeChunks(id, chunks)
    if (wasPublished || saved.status === 'published') {
      await this.refreshIndexSafely()
    }
    return this.getDetail(id)
  }

  async publish(id: string): Promise<LegalDocDetail> {
    return this.setStatus(id, 'published')
  }

  async unpublish(id: string): Promise<LegalDocDetail> {
    return this.setStatus(id, 'draft')
  }

  /** Soft delete: the doc stays in the DB but leaves the search index. */
  async archive(id: string): Promise<{ ok: true }> {
    await this.setStatus(id, 'archived')
    return { ok: true }
  }

  /** Searches PUBLISHED chunks only (same engine as the chat bot). */
  search(
    query: string,
    limit: number = DEFAULT_SEARCH_LIMIT
  ): Promise<LegalSearchHit[]> {
    const hits = this.index.search(query, limit, SEARCH_MIN_SCORE).map(hit => ({
      docId: hit.meta.docId,
      title: hit.meta.title,
      docNumber: hit.meta.docNumber,
      issuer: hit.meta.issuer,
      heading: hit.meta.heading,
      text: hit.meta.text.slice(0, HIT_TEXT_MAX),
      score: hit.score,
      sourceUrl: hit.meta.sourceUrl,
    }))
    return Promise.resolve(hits)
  }

  /** Downloads a public legal page, extracts its text and distils it with AI. */
  async fetchAndDistill(url: string): Promise<FetchLegalLinkResult> {
    let page: Awaited<ReturnType<typeof fetchPageHtml>>
    try {
      page = await fetchPageHtml(url)
    } catch (error) {
      throw toFetchException(error)
    }

    const extracted = extractMainText(page.html)
    const text = extracted.text
    if (text.length < MIN_EXTRACTED_CHARS) {
      throw new BadRequestException(SHORT_TEXT_MESSAGE)
    }

    const pageTitle = extracted.title
    const distilled = await distillLegalPage(
      {
        ...(pageTitle ? { pageTitle } : {}),
        url: page.finalUrl,
        text,
      },
      this.groqKeyPool
    )

    return {
      url,
      finalUrl: page.finalUrl,
      ...(pageTitle ? { pageTitle } : {}),
      rawCharCount: text.length,
      content: distilled.content,
      distilled: distilled.distilled,
      suggestion: distilled.suggestion,
    }
  }

  /** Rebuilds the in-memory index from all published chunks. Errors are logged, not thrown. */
  async refreshIndexSafely(): Promise<void> {
    try {
      await this.rebuildIndex()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to rebuild legal knowledge index: ${message}`)
    }
  }

  private async rebuildIndex(): Promise<void> {
    const published = await this.docRepo.find({
      where: {
        status: 'published',
      } as FindOptionsWhere<LegalKnowledgeDoc>,
    })
    if (published.length === 0) {
      this.index.build([])
      return
    }

    const docsById = new Map(
      published.map(doc => [doc._id.toHexString(), doc] as const)
    )
    const chunks = await this.chunkRepo.find({
      // TypeORM's Mongo driver rejects array `where`; use $in instead.
      where: {
        docId: { $in: [...docsById.keys()] },
      } as unknown as FindOptionsWhere<LegalKnowledgeChunk>,
    })

    const entries: Bm25Doc<IndexedChunkMeta>[] = []
    for (const chunk of chunks) {
      const doc = docsById.get(chunk.docId)
      if (!doc) continue
      const heading = chunk.heading || undefined
      entries.push({
        id: chunk._id.toHexString(),
        text: [doc.title, doc.docNumber ?? '', heading ?? '', chunk.text]
          .filter(part => part.length > 0)
          .join('\n'),
        keywords: doc.keywords ?? [],
        meta: {
          docId: chunk.docId,
          title: doc.title,
          docNumber: doc.docNumber || undefined,
          issuer: doc.issuer || undefined,
          sourceUrl: doc.sourceUrl || undefined,
          heading,
          text: chunk.text,
        },
      })
    }
    this.index.build(entries)
  }

  private async setStatus(
    id: string,
    status: LegalDocStatus
  ): Promise<LegalDocDetail> {
    const doc = await this.findById(id)
    const wasPublished = doc.status === 'published'
    doc.status = status
    await this.docRepo.save(doc)
    if (wasPublished || status === 'published') {
      await this.refreshIndexSafely()
    }
    return this.getDetail(id)
  }

  /** Replaces all chunks of a doc (delete old, insert new). */
  private async writeChunks(
    docId: string,
    chunks: LegalChunkDraft[]
  ): Promise<void> {
    await this.chunkRepo.deleteMany({ docId })
    if (chunks.length === 0) return
    const entities = chunks.map(chunk =>
      this.chunkRepo.create({
        docId,
        order: chunk.order,
        heading: chunk.heading,
        text: chunk.text,
      })
    )
    await this.chunkRepo.insertMany(entities)
  }

  private async findById(id: string): Promise<LegalKnowledgeDoc> {
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new BadRequestException('id không hợp lệ')
    }
    const doc = await this.docRepo.findOneBy({ _id: new ObjectId(id) })
    if (!doc) throw new NotFoundException('Không tìm thấy tài liệu')
    return doc
  }
}

function toItem(doc: LegalKnowledgeDoc): LegalDocItem {
  return {
    _id: doc._id.toHexString(),
    title: doc.title,
    category: doc.category,
    keywords: doc.keywords ?? [],
    status: doc.status,
    chunkCount: doc.chunkCount ?? 0,
    contentLength: doc.content.length,
    contentSource: doc.contentSource,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
    ...(doc.docNumber ? { docNumber: doc.docNumber } : {}),
    ...(doc.issuer ? { issuer: doc.issuer } : {}),
    ...(doc.sourceUrl ? { sourceUrl: doc.sourceUrl } : {}),
    ...(doc.summary ? { summary: doc.summary } : {}),
    ...(doc.effectiveDate
      ? { effectiveDate: new Date(doc.effectiveDate).toISOString() }
      : {}),
    ...(doc.fetchedAt
      ? { fetchedAt: new Date(doc.fetchedAt).toISOString() }
      : {}),
  }
}

function toDetail(doc: LegalKnowledgeDoc): LegalDocDetail {
  return { ...toItem(doc), content: doc.content }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  return new Date(value)
}

/** Maps safe-fetch failures to HTTP errors with a Vietnamese reason. */
function toFetchException(error: unknown): Error {
  if (!(error instanceof SafeFetchError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  switch (error.code) {
    case 'BLOCKED':
      return new BadRequestException(
        'Địa chỉ không được phép truy cập (chỉ trang công khai, giao thức http/https)'
      )
    case 'BAD_TYPE':
      return new BadRequestException(
        'Liên kết không phải trang HTML hoặc văn bản thuần'
      )
    case 'TOO_LARGE':
      return new BadRequestException(
        'Trang quá lớn để chắt lọc (vượt giới hạn tải về)'
      )
    case 'HTTP':
      return new BadRequestException(
        `Trang nguồn trả về lỗi HTTP ${error.status ?? ''}`.trim()
      )
    case 'TIMEOUT':
      return new BadGatewayException('Hết thời gian tải trang, hãy thử lại sau')
    case 'NETWORK':
      return new BadGatewayException('Không kết nối được tới trang nguồn')
    default:
      return error
  }
}
