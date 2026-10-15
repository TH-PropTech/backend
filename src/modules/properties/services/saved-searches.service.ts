import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import type { SavedSearchFilters } from '../schemas/saved-search.schema'
import type { AlertTriggerType } from '../schemas/search-alert.schema'
import { SavedSearchRecord } from '../schemas/saved-search-record.schema'
import { SavedSearchRecordRepository } from '../utils/saved-search-record.repository'
import {
  toSavedSearchView,
  toSearchAlertView,
  type SavedSearchView,
  type SearchAlertView,
} from '../mappers/saved-search-record.mapper'
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
} from '../dto/saved-search.dto'
import { AlertQueryDto } from '../dto/alert-query.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import type { Apartment } from '../schemas/apartment.schema'

/** Maximum saved searches per user (chỉ đếm kind='search') */
const MAX_SAVED_SEARCHES = 10

/** Minimum interval (ms) between duplicate alerts for same listing */
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 hours

export interface SavedSearchListResult {
  items: SavedSearchView[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AlertListResult {
  items: SearchAlertView[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name)

  /** Bộ lọc đã lưu (kind 'search'): mọi truy vấn đã có `kind` qua facade. */
  private readonly savedSearchRepository: SavedSearchRecordRepository
  /** Cảnh báo (kind 'alert'): mọi truy vấn đã có `kind` qua facade. */
  private readonly alertRepository: SavedSearchRecordRepository

  constructor(
    @InjectRepository(SavedSearchRecord)
    records: Repository<SavedSearchRecord>
  ) {
    this.savedSearchRepository = new SavedSearchRecordRepository(
      records,
      'search'
    )
    this.alertRepository = new SavedSearchRecordRepository(records, 'alert')
  }

  /**
   * Tạo saved search mới — tối đa 10 per user
   * [uc_saved_search_create]
   */
  async createSavedSearch(
    userId: string,
    dto: CreateSavedSearchDto
  ): Promise<SavedSearchView> {
    this.logger.log(`User ${userId} creating saved search: ${dto.name}`)

    const existingSearches = await this.savedSearchRepository.find({
      where: { userId },
    })

    if (existingSearches.length >= MAX_SAVED_SEARCHES) {
      throw new BadRequestException(
        `Chỉ được lưu tối đa ${MAX_SAVED_SEARCHES} bộ lọc tìm kiếm`
      )
    }

    const search = this.savedSearchRepository.create({
      userId,
      name: dto.name,
      filters: dto.filters,
      alertEnabled: dto.alertEnabled ?? true,
      alertFrequency: dto.alertFrequency ?? 'daily',
      matchCount: 0,
    })

    return toSavedSearchView(await this.savedSearchRepository.save(search))
  }

  /**
   * Cập nhật saved search — ownership check
   */
  async updateSavedSearch(
    searchId: string,
    userId: string,
    dto: UpdateSavedSearchDto
  ): Promise<SavedSearchView> {
    this.logger.log(`User ${userId} updating saved search ${searchId}`)
    const search = await this.findSearchOrThrow(searchId, userId)

    if (dto.name) search.name = dto.name
    if (dto.filters) search.filters = dto.filters
    if (dto.alertFrequency) search.alertFrequency = dto.alertFrequency

    return toSavedSearchView(await this.savedSearchRepository.save(search))
  }

  /**
   * Xóa saved search — giữ alerts
   */
  async deleteSavedSearch(searchId: string, userId: string): Promise<void> {
    this.logger.log(`User ${userId} deleting saved search ${searchId}`)
    const search = await this.findSearchOrThrow(searchId, userId)
    await this.savedSearchRepository.remove(search)
  }

  /**
   * Bật/tắt cảnh báo mà không xóa saved search
   */
  async toggleAlert(
    searchId: string,
    userId: string,
    enabled: boolean
  ): Promise<SavedSearchView> {
    this.logger.log(
      `User ${userId} toggling alert ${enabled ? 'ON' : 'OFF'} for ${searchId}`
    )
    const search = await this.findSearchOrThrow(searchId, userId)
    search.alertEnabled = enabled
    return toSavedSearchView(await this.savedSearchRepository.save(search))
  }

  /**
   * Lấy danh sách saved searches của user
   */
  async getMySavedSearches(
    userId: string,
    query: PaginationQueryDto
  ): Promise<SavedSearchListResult> {
    const allRecords = await this.savedSearchRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    })

    return this.paginateSavedSearches(allRecords, query)
  }

  /**
   * Lấy danh sách alerts của user — phân trang, filter read/unread
   */
  async getAlerts(
    userId: string,
    query: AlertQueryDto
  ): Promise<AlertListResult> {
    const where: Record<string, unknown> = { userId }
    if (query.isRead !== undefined) {
      where.isRead = query.isRead === 'true'
    }

    const allRecords = await this.alertRepository.find({
      where,
      order: { createdAt: 'DESC' },
    })

    return this.paginateAlerts(allRecords, query)
  }

  /**
   * Đánh dấu alert đã đọc
   */
  async markAlertRead(
    alertId: string,
    userId: string
  ): Promise<SearchAlertView> {
    const alert = await this.findAlertOrThrow(alertId, userId)
    alert.isRead = true
    return toSearchAlertView(await this.alertRepository.save(alert))
  }

  /**
   * Đánh dấu tất cả alerts đã đọc
   */
  async markAllAlertsRead(userId: string): Promise<void> {
    const unread = await this.alertRepository.find({
      where: { userId, isRead: false },
    })

    if (unread.length > 0) {
      for (const alert of unread) {
        alert.isRead = true
      }
      await this.alertRepository.save(unread)
    }
  }

  async generateAlertsForApartment(
    apartment: Apartment,
    triggerType: AlertTriggerType,
    matchDetails: { previousValue?: string; newValue?: string } = {}
  ): Promise<void> {
    const apartmentId = apartment._id.toString()
    this.logger.log(
      `Generating alerts for apartment ${apartmentId} - trigger: ${triggerType}`
    )

    const activeSearches = await this.savedSearchRepository.find({
      where: { alertEnabled: true },
    })

    const now = Date.now()
    const alertsToCreate: SavedSearchRecord[] = []
    const matchedSearches: SavedSearchRecord[] = []

    for (const search of activeSearches) {
      if (
        !this.matchesFilters(
          apartment,
          search.filters ?? {},
          triggerType !== 'status_change'
        )
      ) {
        continue
      }

      const savedSearchId = search._id.toString()
      const dedupKey = `${savedSearchId}:${apartmentId}:${triggerType}`

      const existingAlert = await this.alertRepository.findOne({
        where: { deduplicationKey: dedupKey },
        order: { createdAt: 'DESC' },
      })

      if (existingAlert) {
        const lastSent = new Date(existingAlert.createdAt).getTime()
        if (now - lastSent < DEDUP_WINDOW_MS) continue
      }

      const matchReason = this.buildMatchReason(triggerType, matchDetails)

      const alertData: Partial<SavedSearchRecord> = {
        savedSearchId,
        userId: search.userId,
        apartmentId,
        apartmentTitle: apartment.title,
        triggerType,
        matchReason,
        isRead: false,
        isDismissed: false,
        deduplicationKey: dedupKey,
      }
      if (matchDetails.previousValue)
        alertData.previousValue = matchDetails.previousValue
      if (matchDetails.newValue) alertData.newValue = matchDetails.newValue

      const alert = this.alertRepository.create(alertData)
      alertsToCreate.push(alert)
      search.matchCount = (search.matchCount ?? 0) + 1
      search.lastAlertSentAt = new Date(now)
      matchedSearches.push(search)
    }

    if (alertsToCreate.length > 0) {
      await this.alertRepository.save(alertsToCreate)
      await this.savedSearchRepository.save(matchedSearches)
      this.logger.log(`Created ${alertsToCreate.length} alerts`)
    }
  }

  // ─── Private Helpers ───────────────────────────────────

  private buildMatchReason(
    triggerType: AlertTriggerType,
    details: { previousValue?: string; newValue?: string }
  ): string {
    switch (triggerType) {
      case 'new_listing':
        return 'Tin đăng mới phù hợp với bộ lọc đã lưu'
      case 'price_change':
        return `Giá thuê thay đổi từ ${details.previousValue ?? '--'} → ${details.newValue ?? '--'}`
      case 'status_change':
        return `Trạng thái thay đổi: ${details.newValue ?? '--'}`
      case 'expiring_soon':
        return 'Căn hộ sắp hết hạn đăng, có thể không còn trống'
      default:
        return 'Có thay đổi phù hợp với bộ lọc đã lưu'
    }
  }

  private matchesFilters(
    apartment: Apartment,
    filters: SavedSearchFilters,
    requireAvailable = true
  ): boolean {
    if (
      requireAvailable &&
      (apartment.status !== 'available' || !apartment.isVerified)
    ) {
      return false
    }

    const normalizedIncludes = (value: string, expected: string): boolean =>
      value
        .trim()
        .toLocaleLowerCase('vi')
        .includes(expected.trim().toLocaleLowerCase('vi'))
    const equals = (value: string, expected: string): boolean =>
      value.trim().localeCompare(expected.trim(), 'vi', {
        sensitivity: 'base',
      }) === 0

    if (filters.city && !normalizedIncludes(apartment.city, filters.city)) {
      return false
    }
    if (
      filters.district &&
      !normalizedIncludes(apartment.district, filters.district)
    ) {
      return false
    }
    if (filters.ward && !normalizedIncludes(apartment.ward, filters.ward)) {
      return false
    }
    if (
      filters.minPrice !== undefined &&
      apartment.priceMonthly < filters.minPrice * 1_000_000
    ) {
      return false
    }
    if (
      filters.maxPrice !== undefined &&
      apartment.priceMonthly > filters.maxPrice * 1_000_000
    ) {
      return false
    }
    if (filters.minArea !== undefined && apartment.area < filters.minArea) {
      return false
    }
    if (filters.maxArea !== undefined && apartment.area > filters.maxArea) {
      return false
    }
    if (
      filters.bedrooms !== undefined &&
      apartment.bedrooms !== filters.bedrooms
    ) {
      return false
    }
    if (
      filters.bathrooms !== undefined &&
      apartment.bathrooms !== filters.bathrooms
    ) {
      return false
    }
    if (filters.category && !equals(apartment.category, filters.category)) {
      return false
    }
    if (
      filters.furniture &&
      !normalizedIncludes(apartment.furniture, filters.furniture)
    ) {
      return false
    }
    if (
      filters.moveInTime &&
      !equals(apartment.moveInTime, filters.moveInTime)
    ) {
      return false
    }
    if (
      filters.amenities?.some(
        amenity => !apartment.amenities.some(item => equals(item, amenity))
      )
    ) {
      return false
    }
    if (filters.petFriendly === true) {
      const hasPetAmenity = apartment.amenities.some(amenity => {
        const normalized = amenity.toLocaleLowerCase('vi')
        return normalized.includes('pet') || normalized.includes('thú cưng')
      })
      if (!hasPetAmenity) return false
    }

    return true
  }

  private async findSearchOrThrow(
    searchId: string,
    userId: string
  ): Promise<SavedSearchRecord> {
    let search: SavedSearchRecord | null = null
    try {
      search = await this.savedSearchRepository.findOne({
        where: { _id: new ObjectId(searchId) },
      })
    } catch {
      throw new NotFoundException(`ID tìm kiếm không hợp lệ: ${searchId}`)
    }
    if (!search) {
      throw new NotFoundException(`Không tìm thấy bộ lọc: ${searchId}`)
    }
    if (search.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập bộ lọc này')
    }
    return search
  }

  private async findAlertOrThrow(
    alertId: string,
    userId: string
  ): Promise<SavedSearchRecord> {
    let alert: SavedSearchRecord | null = null
    try {
      alert = await this.alertRepository.findOne({
        where: { _id: new ObjectId(alertId) },
      })
    } catch {
      throw new NotFoundException(`ID cảnh báo không hợp lệ: ${alertId}`)
    }
    if (!alert) {
      throw new NotFoundException(`Không tìm thấy cảnh báo: ${alertId}`)
    }
    if (alert.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cảnh báo này')
    }
    return alert
  }

  private paginateSavedSearches(
    records: SavedSearchRecord[],
    query: PaginationQueryDto
  ): SavedSearchListResult {
    const total = records.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = records.slice(skip, skip + limit).map(toSavedSearchView)
    return { items, total, page, limit, totalPages }
  }

  private paginateAlerts(
    records: SavedSearchRecord[],
    query: AlertQueryDto
  ): AlertListResult {
    const total = records.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = records.slice(skip, skip + limit).map(toSearchAlertView)
    return { items, total, page, limit, totalPages }
  }
}
