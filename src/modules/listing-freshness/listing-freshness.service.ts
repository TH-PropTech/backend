import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Apartment } from '../apartments/schemas/apartment.schema'
import type { ListingReviewQueryDto } from './dto/listing-freshness-query.dto'
import {
  ListingReviewCase,
  type ListingReviewStatus,
  type ListingReviewType,
} from './schemas/listing-review-case.schema'

const DAY_MS = 24 * 60 * 60 * 1000
const NEEDS_CONFIRMATION_DAYS = 30
const STALE_DAYS = 60
const SIMILARITY_THRESHOLD = 0.8

export type FreshnessStatus = 'fresh' | 'needs_confirmation' | 'stale'

export interface FreshnessResult {
  apartmentId: string
  status: FreshnessStatus
  daysSinceUpdate: number
  needsConfirmation: boolean
  lastUpdatedAt: Date
}

export interface ListingReviewListResult {
  items: ListingReviewCase[]
  total: number
  page: number
  limit: number
  totalPages: number
}

interface DuplicateSignal {
  type: Exclude<ListingReviewType, 'stale' | 'duplicate_phone'>
  confidence: number
  evidence: string
}

@Injectable()
export class ListingFreshnessService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(ListingReviewCase)
    private readonly reviewCaseRepository: Repository<ListingReviewCase>
  ) {}

  /** [uc_staff_apartment] Calculate freshness without mutating the listing. */
  async checkFreshness(apartmentId: string): Promise<FreshnessResult> {
    const apartment = await this.findApartmentOrThrow(apartmentId)
    return this.toFreshnessResult(apartment)
  }

  /** [uc_staff_apartment] Reset freshness for the listing owner only. */
  async confirmListing(
    apartmentId: string,
    landlordId: string
  ): Promise<FreshnessResult> {
    const apartment = await this.findApartmentOrThrow(apartmentId)
    if (apartment.landlordId !== landlordId) {
      throw new ForbiddenException('Bạn không có quyền xác nhận tin đăng này')
    }

    apartment.updatedAt = new Date()
    const saved = await this.apartmentRepository.save(apartment)
    return this.toFreshnessResult(saved)
  }

  /** [uc_staff_apartment] Create review signals without changing listings. */
  async detectDuplicates(apartmentId: string): Promise<ListingReviewCase[]> {
    const target = await this.findApartmentOrThrow(apartmentId)
    const apartments = await this.apartmentRepository.find()
    const cases: ListingReviewCase[] = []

    for (const candidate of apartments) {
      if (candidate._id.toString() === target._id.toString()) continue

      const signals = this.collectDuplicateSignals(target, candidate)
      for (const signal of signals) {
        cases.push(
          await this.findOrCreatePendingCase(target, candidate, signal)
        )
      }
    }

    return cases
  }

  /** [uc_staff_apartment] Paginated moderation queue. */
  async getReviewQueue(
    query: ListingReviewQueryDto
  ): Promise<ListingReviewListResult> {
    const records = await this.reviewCaseRepository.find({
      order: { createdAt: 'DESC' },
    })
    const filtered = records.filter(record => {
      if (query.type && record.type !== query.type) return false
      if (query.status && record.status !== query.status) return false
      return true
    })
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const total = filtered.length
    const totalPages = Math.ceil(total / limit)
    const start = (page - 1) * limit

    return {
      items: filtered.slice(start, start + limit),
      total,
      page,
      limit,
      totalPages,
    }
  }

  /** [uc_staff_apartment] Resolve a pending signal; listings stay unchanged. */
  async reviewCase(
    caseId: string,
    reviewerId: string,
    status: Exclude<ListingReviewStatus, 'pending'>
  ): Promise<ListingReviewCase> {
    const reviewCase = await this.findCaseOrThrow(caseId)
    if (reviewCase.status !== 'pending') {
      throw new BadRequestException('Review case đã được xử lý')
    }

    reviewCase.status = status
    reviewCase.reviewedBy = reviewerId
    reviewCase.reviewedAt = new Date()
    return this.reviewCaseRepository.save(reviewCase)
  }

  private toFreshnessResult(apartment: Apartment): FreshnessResult {
    const daysSinceUpdate = Math.max(
      0,
      Math.floor((Date.now() - apartment.updatedAt.getTime()) / DAY_MS)
    )
    const status: FreshnessStatus =
      daysSinceUpdate > STALE_DAYS
        ? 'stale'
        : daysSinceUpdate > NEEDS_CONFIRMATION_DAYS
          ? 'needs_confirmation'
          : 'fresh'

    return {
      apartmentId: apartment._id.toString(),
      status,
      daysSinceUpdate,
      needsConfirmation: status !== 'fresh',
      lastUpdatedAt: apartment.updatedAt,
    }
  }

  private collectDuplicateSignals(
    target: Apartment,
    candidate: Apartment
  ): DuplicateSignal[] {
    const signals: DuplicateSignal[] = []
    const targetImages = new Set(target.gallery.filter(Boolean))
    const sharedImages = candidate.gallery.filter(image =>
      targetImages.has(image)
    )
    if (sharedImages.length > 0) {
      signals.push({
        type: 'duplicate_photo',
        confidence: 1,
        evidence: `${sharedImages.length} URL ảnh trùng khớp`,
      })
    }

    if (
      this.normalizeText(target.address) !== '' &&
      this.normalizeText(target.address) ===
        this.normalizeText(candidate.address)
    ) {
      signals.push({
        type: 'duplicate_location',
        confidence: 0.9,
        evidence: 'Địa chỉ chuẩn hóa trùng khớp',
      })
    }

    const similarity = this.calculateContentSimilarity(
      `${target.title} ${target.description}`,
      `${candidate.title} ${candidate.description}`
    )
    if (similarity >= SIMILARITY_THRESHOLD) {
      signals.push({
        type: 'similar_content',
        confidence: Number(similarity.toFixed(2)),
        evidence: `Độ tương đồng nội dung ${Math.round(similarity * 100)}%`,
      })
    }

    return signals
  }

  private async findOrCreatePendingCase(
    target: Apartment,
    candidate: Apartment,
    signal: DuplicateSignal
  ): Promise<ListingReviewCase> {
    const apartmentId = target._id.toString()
    const relatedApartmentId = candidate._id.toString()
    const existing = await this.reviewCaseRepository.findOne({
      where: {
        apartmentId,
        relatedApartmentId,
        type: signal.type,
        status: 'pending',
      },
    })
    if (existing) return existing

    const reviewCase = this.reviewCaseRepository.create({
      apartmentId,
      relatedApartmentId,
      type: signal.type,
      confidence: signal.confidence,
      evidence: signal.evidence,
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
    })
    return this.reviewCaseRepository.save(reviewCase)
  }

  private calculateContentSimilarity(left: string, right: string): number {
    const leftTokens = new Set(
      this.normalizeText(left).split(' ').filter(Boolean)
    )
    const rightTokens = new Set(
      this.normalizeText(right).split(' ').filter(Boolean)
    )
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0

    const intersection = [...leftTokens].filter(token =>
      rightTokens.has(token)
    ).length
    const union = new Set([...leftTokens, ...rightTokens]).size
    return intersection / union
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private async findApartmentOrThrow(apartmentId: string): Promise<Apartment> {
    if (!ObjectId.isValid(apartmentId)) {
      throw new NotFoundException(`ID căn hộ không hợp lệ: ${apartmentId}`)
    }
    const apartment = await this.apartmentRepository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    if (!apartment) {
      throw new NotFoundException(`Không tìm thấy căn hộ: ${apartmentId}`)
    }
    return apartment
  }

  private async findCaseOrThrow(caseId: string): Promise<ListingReviewCase> {
    if (!ObjectId.isValid(caseId)) {
      throw new NotFoundException(`ID review case không hợp lệ: ${caseId}`)
    }
    const reviewCase = await this.reviewCaseRepository.findOne({
      where: { _id: new ObjectId(caseId) },
    })
    if (!reviewCase) {
      throw new NotFoundException(`Không tìm thấy review case: ${caseId}`)
    }
    return reviewCase
  }
}
