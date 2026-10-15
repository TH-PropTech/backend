import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../../services/apartments.service'
import {
  CreateAreaProfileDto,
  UpdateAreaProfileDto,
} from '../dto/create-area-profile.dto'
import { AreaProfileQueryDto } from '../dto/area-profile-query.dto'
import { DistrictData } from '../schemas/district-data.schema'
import {
  toAreaProfileView,
  type AreaProfileView,
} from '../utils/district-data.mapper'

const DEFAULT_DISCLAIMER =
  'Thông tin mang tính tham khảo, được cập nhật theo khảo sát và không phải cam kết của chủ nhà hay nền tảng.'
const KIND = 'area-profile' as const

export interface ProfileListResult {
  items: AreaProfileView[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class AreaProfilesService {
  constructor(
    @InjectRepository(DistrictData)
    private readonly repository: Repository<DistrictData>,
    private readonly apartmentsService: ApartmentsService
  ) {}
  async getByDistrict(
    district: string,
    city: string
  ): Promise<AreaProfileView | null> {
    const row = await this.repository.findOne({
      where: { kind: KIND, district, city },
    })
    return row ? toAreaProfileView(row) : null
  }
  async getForApartment(apartmentId: string): Promise<AreaProfileView | null> {
    const apartment = await this.apartmentsService.findOne(apartmentId)
    return this.getByDistrict(apartment.district, apartment.city)
  }
  async getAllProfiles(query: AreaProfileQueryDto): Promise<ProfileListResult> {
    const records = await this.repository.find({
      where: { kind: KIND },
      order: { updatedAt: 'DESC' },
    })
    const filtered = records.filter(
      item =>
        (!query.district || item.district === query.district) &&
        (!query.city || item.city === query.city)
    )
    const start = (query.page - 1) * query.limit
    return {
      items: filtered.slice(start, start + query.limit).map(toAreaProfileView),
      total: filtered.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(filtered.length / query.limit),
    }
  }
  async getById(id: string): Promise<AreaProfileView> {
    return toAreaProfileView(await this.findOrThrow(id))
  }
  async createProfile(dto: CreateAreaProfileDto): Promise<AreaProfileView> {
    const profile = this.repository.create({
      ...dto,
      kind: KIND,
      disclaimer: dto.disclaimer ?? DEFAULT_DISCLAIMER,
      lastSurveyedAt: new Date(),
    })
    return toAreaProfileView(await this.repository.save(profile))
  }
  async updateProfile(
    id: string,
    dto: UpdateAreaProfileDto
  ): Promise<AreaProfileView> {
    const profile = await this.findOrThrow(id)
    Object.assign(profile, dto)
    profile.kind = KIND
    return toAreaProfileView(await this.repository.save(profile))
  }
  async deleteProfile(id: string): Promise<void> {
    await this.repository.remove(await this.findOrThrow(id))
  }
  private async findOrThrow(id: string): Promise<DistrictData> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Area profile not found')
    const profile = await this.repository.findOne({
      where: { _id: new ObjectId(id), kind: KIND },
    })
    if (!profile) throw new NotFoundException('Area profile not found')
    return profile
  }
}
