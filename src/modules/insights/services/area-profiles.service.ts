import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../../properties/services/apartments.service'
import {
  CreateAreaProfileDto,
  UpdateAreaProfileDto,
} from '../dto/create-area-profile.dto'
import { AreaProfileQueryDto } from '../dto/area-profile-query.dto'
import { AreaProfile } from '../schemas/area-profile.schema'

const DEFAULT_DISCLAIMER =
  'Thông tin mang tính tham khảo, được cập nhật theo khảo sát và không phải cam kết của chủ nhà hay nền tảng.'
export interface ProfileListResult {
  items: AreaProfile[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class AreaProfilesService {
  constructor(
    @InjectRepository(AreaProfile)
    private readonly repository: Repository<AreaProfile>,
    private readonly apartmentsService: ApartmentsService
  ) {}
  async getByDistrict(
    district: string,
    city: string
  ): Promise<AreaProfile | null> {
    return this.repository.findOne({ where: { district, city } })
  }
  async getForApartment(apartmentId: string): Promise<AreaProfile | null> {
    const apartment = await this.apartmentsService.findOne(apartmentId)
    return this.getByDistrict(apartment.district, apartment.city)
  }
  async getAllProfiles(query: AreaProfileQueryDto): Promise<ProfileListResult> {
    const records = await this.repository.find({ order: { updatedAt: 'DESC' } })
    const filtered = records.filter(
      item =>
        (!query.district || item.district === query.district) &&
        (!query.city || item.city === query.city)
    )
    const start = (query.page - 1) * query.limit
    return {
      items: filtered.slice(start, start + query.limit),
      total: filtered.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(filtered.length / query.limit),
    }
  }
  async getById(id: string): Promise<AreaProfile> {
    return this.findOrThrow(id)
  }
  async createProfile(dto: CreateAreaProfileDto): Promise<AreaProfile> {
    const profile = this.repository.create({
      ...dto,
      disclaimer: dto.disclaimer ?? DEFAULT_DISCLAIMER,
      lastSurveyedAt: new Date(),
    })
    return this.repository.save(profile)
  }
  async updateProfile(
    id: string,
    dto: UpdateAreaProfileDto
  ): Promise<AreaProfile> {
    const profile = await this.findOrThrow(id)
    Object.assign(profile, dto)
    return this.repository.save(profile)
  }
  async deleteProfile(id: string): Promise<void> {
    await this.repository.remove(await this.findOrThrow(id))
  }
  private async findOrThrow(id: string): Promise<AreaProfile> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Area profile not found')
    const profile = await this.repository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!profile) throw new NotFoundException('Area profile not found')
    return profile
  }
}
