import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { FindOptionsWhere, MongoRepository, Repository } from 'typeorm'
import { ReadCacheService } from '../../health/services/read-cache.service'
import { User } from '../../users/schemas/user.schema'
import { ApartmentFilterDto } from '../dto/apartment-filter.dto'
import {
  ApartmentResponseMapper,
  MobileApartmentResponse,
  WebApartmentResponse,
} from '../mappers/apartment-response.mapper'
import { Apartment } from '../schemas/apartment.schema'
import { buildApartmentQuery } from '../utils/apartment-query.builder'
import {
  attachCurrentLandlords,
  type ApartmentWithLandlord,
} from '../utils/attach-landlords'
import type { ListingPage } from '../utils/listing-pagination'
import { APARTMENT_CACHE_NAMESPACE } from '../../read-model/services/apartment-cache-invalidator.service'

export type PublicApartmentFormat = 'web' | 'mobile'
export type PublicApartmentResponse =
  | WebApartmentResponse
  | MobileApartmentResponse

export interface PublicApartmentPage {
  items: PublicApartmentResponse[]
  total: number
}

/**
 * Phía đọc công khai của căn hộ (CQRS nhẹ): chỉ đọc, có cache, có giới hạn kích thước.
 * Luồng nghiệp vụ (thuê, hợp đồng, AI) vẫn đọc trực tiếp qua ApartmentsService, không qua cache.
 */
@Injectable()
export class ApartmentsQueryService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: MongoRepository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly readCache: ReadCacheService
  ) {}

  findPublicPage(
    filters: ApartmentFilterDto,
    format: PublicApartmentFormat,
    page: ListingPage
  ): Promise<PublicApartmentPage> {
    return this.readCache.wrap(
      APARTMENT_CACHE_NAMESPACE,
      { kind: 'list', filters, format, ...page },
      () => this.loadPage(filters, format, page)
    )
  }

  async findPublicById(
    id: string,
    format: PublicApartmentFormat
  ): Promise<PublicApartmentResponse> {
    return this.readCache.wrap(
      APARTMENT_CACHE_NAMESPACE,
      { kind: 'detail', id, format },
      () => this.loadById(id, format)
    )
  }

  private async loadPage(
    filters: ApartmentFilterDto,
    format: PublicApartmentFormat,
    { skip, take }: ListingPage
  ): Promise<PublicApartmentPage> {
    const where = buildApartmentQuery(
      filters
    ) as unknown as FindOptionsWhere<Apartment>
    const [apartments, total] = await Promise.all([
      this.apartmentRepository.find({
        where,
        order: { createdAt: 'DESC' },
        skip,
        take,
      }),
      // MongoRepository.count nhận filter thô; countDocuments tránh nhầm với FindOptions { where }
      this.apartmentRepository.countDocuments(where),
    ])
    const withLandlords = await attachCurrentLandlords(
      this.userRepository,
      apartments
    )
    return { items: withLandlords.map(apt => toResponse(apt, format)), total }
  }

  /**
   * Giữ hành vi cũ của GET /apartments/:id: tra theo _id, không thấy thì khớp theo tiêu đề,
   * mọi lỗi khác đều thành 404. Khác cũ ở chỗ nhánh tiêu đề chỉ nạp _id và title.
   */
  private async loadById(
    id: string,
    format: PublicApartmentFormat
  ): Promise<PublicApartmentResponse> {
    try {
      const apartment =
        (ObjectId.isValid(id)
          ? await this.apartmentRepository.findOne({
              where: { _id: new ObjectId(id) },
            })
          : null) ?? (await this.findByTitleHint(id))
      if (!apartment) {
        throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
      }
      const [withLandlord] = await attachCurrentLandlords(this.userRepository, [
        apartment,
      ])
      return toResponse(withLandlord as ApartmentWithLandlord, format)
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      throw new NotFoundException(
        `ID căn hộ không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }

  private async findByTitleHint(hint: string): Promise<Apartment | null> {
    const needle = hint.toLowerCase()
    const titles = await this.apartmentRepository.find({
      select: ['_id', 'title'],
    })
    const match = titles.find(
      row =>
        row.title.toLowerCase().includes(needle) ||
        needle.includes(row.title.toLowerCase())
    )
    return match
      ? this.apartmentRepository.findOne({ where: { _id: match._id } })
      : null
  }
}

function toResponse(
  apartment: ApartmentWithLandlord,
  format: PublicApartmentFormat
): PublicApartmentResponse {
  return format === 'mobile'
    ? ApartmentResponseMapper.toMobileJson(apartment)
    : ApartmentResponseMapper.toWebJson(apartment)
}
