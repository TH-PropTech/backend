import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { Apartment } from '../schemas/apartment.schema'

export interface ScoreBreakdown {
  category:
    | 'photos'
    | 'description'
    | 'completeness'
    | 'amenities'
    | 'freshness'
    | 'location'
  label: string
  score: number
  maxScore: number
}
export interface ChecklistItem {
  id: string
  label: string
  priority: 'high' | 'medium' | 'low'
  completed: boolean
  category: string
}
export interface QualityScoreResult {
  score: number
  maxScore: 100
  grade: 'excellent' | 'good' | 'fair' | 'poor'
  breakdown: ScoreBreakdown[]
  checklist: ChecklistItem[]
}

@Injectable()
export class ListingQualityService {
  constructor(
    @InjectRepository(Apartment)
    private readonly repository: Repository<Apartment>
  ) {}
  async calculateQualityScore(
    apartmentId: string,
    ownerId: string
  ): Promise<QualityScoreResult> {
    if (!ObjectId.isValid(apartmentId))
      throw new NotFoundException('Apartment not found')
    const apartment = await this.repository.findOne({
      where: { _id: new ObjectId(apartmentId) },
    })
    if (!apartment) throw new NotFoundException('Apartment not found')
    if (apartment.landlordId !== ownerId)
      throw new ForbiddenException('Listing does not belong to current user')
    const photos = Math.min(
      25,
      (apartment.gallery.length >= 8
        ? 25
        : apartment.gallery.length >= 4
          ? 18
          : apartment.gallery.length
            ? 10
            : 0) +
        (apartment.images360.length ? 2 : 0) +
        (apartment.vrUrl.trim() ? 3 : 0)
    )
    const description = apartment.description.trim().length
    const descriptionScore =
      description >= 500
        ? 20
        : description >= 150
          ? 16
          : description >= 50
            ? 10
            : 5
    const completenessFields = [
      apartment.title,
      apartment.location,
      apartment.address,
      apartment.furniture,
      apartment.moveInTime,
      apartment.electricity,
      apartment.water,
      apartment.internet,
      apartment.direction,
      apartment.balconyDirection,
    ]
    const completeness =
      completenessFields.filter(value => value.trim()).length * 2
    const amenities =
      apartment.amenities.length >= 7
        ? 15
        : apartment.amenities.length >= 4
          ? 10
          : apartment.amenities.length
            ? 5
            : 0
    const days = Math.max(
      0,
      Math.floor((Date.now() - apartment.updatedAt.getTime()) / 86400000)
    )
    const freshness = days <= 7 ? 10 : days <= 14 ? 7 : days <= 30 ? 4 : 1
    const locationValues: Array<[string, number]> = [
      [apartment.ward, 3],
      [apartment.district, 3],
      [apartment.street, 2],
      [apartment.city, 2],
    ]
    const location = locationValues.reduce(
      (total, [value, points]) => total + (value.trim() ? points : 0),
      0
    )
    const breakdown: ScoreBreakdown[] = [
      { category: 'photos', label: 'Ảnh & Media', score: photos, maxScore: 25 },
      {
        category: 'description',
        label: 'Mô tả',
        score: descriptionScore,
        maxScore: 20,
      },
      {
        category: 'completeness',
        label: 'Thông tin đầy đủ',
        score: completeness,
        maxScore: 20,
      },
      {
        category: 'amenities',
        label: 'Tiện ích',
        score: amenities,
        maxScore: 15,
      },
      {
        category: 'freshness',
        label: 'Độ mới',
        score: freshness,
        maxScore: 10,
      },
      { category: 'location', label: 'Địa chỉ', score: location, maxScore: 10 },
    ]
    const score = breakdown.reduce((total, item) => total + item.score, 0)
    const checklist: ChecklistItem[] = []
    if (apartment.gallery.length < 5)
      checklist.push({
        id: 'add_more_photos',
        label: 'Thêm ít nhất 5 ảnh chất lượng',
        priority: 'high',
        completed: false,
        category: 'photos',
      })
    if (description < 150)
      checklist.push({
        id: 'improve_description',
        label: 'Viết mô tả chi tiết hơn (≥150 ký tự)',
        priority: 'high',
        completed: false,
        category: 'description',
      })
    if (!apartment.images360.length)
      checklist.push({
        id: 'add_360_photos',
        label: 'Thêm ảnh 360° để tăng ấn tượng',
        priority: 'medium',
        completed: false,
        category: 'photos',
      })
    if (!apartment.vrUrl.trim())
      checklist.push({
        id: 'add_vr_tour',
        label: 'Thêm VR tour',
        priority: 'low',
        completed: false,
        category: 'photos',
      })
    if (apartment.amenities.length < 4)
      checklist.push({
        id: 'list_amenities',
        label: 'Liệt kê đầy đủ tiện ích',
        priority: 'medium',
        completed: false,
        category: 'amenities',
      })
    if (days > 14)
      checklist.push({
        id: 'refresh_listing',
        label: 'Cập nhật tin để tăng độ mới',
        priority: 'high',
        completed: false,
        category: 'freshness',
      })
    return {
      score,
      maxScore: 100,
      grade: this.toGrade(score),
      breakdown,
      checklist,
    }
  }

  toGrade(score: number): QualityScoreResult['grade'] {
    return score >= 85
      ? 'excellent'
      : score >= 70
        ? 'good'
        : score >= 50
          ? 'fair'
          : 'poor'
  }
}
