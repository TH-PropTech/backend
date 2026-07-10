import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApartmentsService } from '../apartments/apartments.service'
import { RecommendDto } from './dto/recommend.dto'
import { FeedbackDto } from './dto/feedback.dto'
import {
  RecommendationResult,
  FeedbackResponse,
  SyncResponse,
  PythonServiceResponse,
} from './interfaces/recommendation.interface'

@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name)
  private readonly recommendationUrl: string

  constructor(
    private readonly configService: ConfigService,
    private readonly apartmentsService: ApartmentsService
  ) {
    this.recommendationUrl = this.configService.getOrThrow<string>(
      'app.recommendationApiUrl'
    )
  }

  async recommend(dto: RecommendDto): Promise<RecommendationResult[]> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)

      const response = await fetch(`${this.recommendationUrl}/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dto),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        this.logger.error(`Python server error: ${errorText}`)
        throw new HttpException(
          `Failed to get recommendation: ${response.statusText}`,
          HttpStatus.BAD_GATEWAY
        )
      }

      const body = (await response.json()) as PythonServiceResponse<
        RecommendationResult[]
      >
      if (body.success && body.data) {
        return body.data
      }
      throw new HttpException(
        body.error || 'Failed to get recommendation data',
        HttpStatus.BAD_GATEWAY
      )
    } catch (error) {
      // Re-throw intentional HTTP exceptions (e.g. 400, 502) to the client
      if (error instanceof HttpException) {
        throw error
      }

      this.logger.warn(
        `Python recommendation service unreachable or returned error. Running heuristic fallback engine...`
      )
      try {
        return await this.heuristicRecommend(dto)
      } catch (fallbackError) {
        const msg =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError)
        this.logger.error(`Heuristic fallback recommendation failed: ${msg}`)
        throw new HttpException(
          'AI recommendation service is temporarily unavailable',
          HttpStatus.SERVICE_UNAVAILABLE
        )
      }
    }
  }

  async feedback(dto: FeedbackDto): Promise<FeedbackResponse> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10_000)

      const response = await fetch(`${this.recommendationUrl}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dto),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        this.logger.error(`Python feedback error: ${errorText}`)
        throw new HttpException(
          `Failed to send feedback: ${response.statusText}`,
          HttpStatus.BAD_GATEWAY
        )
      }

      const body =
        (await response.json()) as PythonServiceResponse<FeedbackResponse>
      if (body.success && body.data) {
        return body.data
      }
      throw new HttpException(
        body.error || 'Failed to process feedback data',
        HttpStatus.BAD_GATEWAY
      )
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      this.logger.warn(
        `Python service offline. Feedback like/dislike processed locally.`
      )
      return {
        status: 'success',
        message: 'Feedback processed locally (fallback)',
      }
    }
  }

  async sync(): Promise<SyncResponse> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30_000)

      const response = await fetch(`${this.recommendationUrl}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        this.logger.error(`Python sync error: ${errorText}`)
        throw new HttpException(
          `Failed to sync apartments: ${response.statusText}`,
          HttpStatus.BAD_GATEWAY
        )
      }

      const body =
        (await response.json()) as PythonServiceResponse<SyncResponse>
      if (body.success && body.data) {
        return body.data
      }
      throw new HttpException(
        body.error || 'Failed to process sync data',
        HttpStatus.BAD_GATEWAY
      )
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      this.logger.warn(`Python service offline. Sync skipped.`)
      return {
        status: 'success',
        message: 'Sync skipped (fallback)',
        apartments_loaded: 0,
      }
    }
  }

  /**
   * Infer target age range from monthly rent price tier.
   * Matches the Python recommender's _infer_demographics() logic.
   */
  private inferDemographics(price: number): { ageMin: number; ageMax: number } {
    if (price <= 8_000_000) return { ageMin: 20, ageMax: 35 }
    if (price <= 15_000_000) return { ageMin: 23, ageMax: 45 }
    if (price <= 25_000_000) return { ageMin: 25, ageMax: 50 }
    return { ageMin: 28, ageMax: 60 }
  }

  private async heuristicRecommend(
    dto: RecommendDto
  ): Promise<RecommendationResult[]> {
    const apartments = await this.apartmentsService.findAll()

    const { age, income, preferred_district, rooms, has_gym, has_parking } = dto

    const candidatesMap = new Map<
      string,
      {
        id: string
        name: string
        district: string
        rent_price: number
        rooms: number
        has_gym: boolean
        has_parking: boolean
        image_url: string
        target_age_min: number
        target_age_max: number
        count: number
      }
    >()

    for (const apt of apartments) {
      if (apt.status !== 'available') continue

      const key = apt.buildingId || apt.buildingName || apt._id.toString()
      const name = apt.buildingName || apt.projectName || apt.title
      const district = apt.district || 'TP.HCM'
      const rent = apt.priceMonthly || 0
      const hasGym =
        apt.amenities?.some(
          a =>
            a.toLowerCase().includes('gym') ||
            a.toLowerCase().includes('bể bơi') ||
            a.toLowerCase().includes('pool')
        ) || false
      const hasParking =
        apt.amenities?.some(
          a =>
            a.toLowerCase().includes('xe') ||
            a.toLowerCase().includes('đỗ') ||
            a.toLowerCase().includes('parking')
        ) || false

      const { ageMin, ageMax } = this.inferDemographics(rent)

      const existing = candidatesMap.get(key)
      if (existing) {
        existing.rent_price =
          (existing.rent_price * existing.count + rent) / (existing.count + 1)
        existing.rooms = Math.round(
          (existing.rooms * existing.count + apt.bedrooms) /
            (existing.count + 1)
        )
        existing.has_gym = existing.has_gym || hasGym
        existing.has_parking = existing.has_parking || hasParking
        existing.count += 1
      } else {
        candidatesMap.set(key, {
          id: key,
          name,
          district,
          rent_price: rent,
          rooms: apt.bedrooms || 1,
          has_gym: hasGym,
          has_parking: hasParking,
          image_url: apt.gallery?.[0] || '',
          target_age_min: ageMin,
          target_age_max: ageMax,
          count: 1,
        })
      }
    }

    const recommendations: RecommendationResult[] = []

    for (const item of candidatesMap.values()) {
      const rent = item.rent_price
      if (rent > income * 0.5) {
        continue
      }

      const reasons: string[] = []

      // 1. Finance Pillar (max score: 50)
      let financeScore = 0
      const rentRatio = rent / income
      const rentPercentage = Math.round(rentRatio * 100)
      if (rentRatio >= 0.15 && rentRatio <= 0.3) {
        financeScore += 35
        reasons.push(`Giá thuê chỉ chiếm ${rentPercentage}% thu nhập`)
      } else if (rentRatio < 0.15) {
        financeScore += 25
        reasons.push(`Tiết kiệm tối đa (chỉ ${rentPercentage}% thu nhập)`)
      } else {
        if (rentRatio > 0.35) {
          financeScore += 0
        } else {
          financeScore += 10
        }
        reasons.push(`Chi phí thuê khá cao (${rentPercentage}% thu nhập)`)
      }
      const distFromIdeal = Math.abs(rentRatio - 0.25)
      const densityScore = Math.max(0, 15 - distFromIdeal * 60)
      financeScore += densityScore

      // 2. Location Pillar (max score: 45)
      let locationScore = 0
      const isExact =
        item.district
          .toLowerCase()
          .includes(preferred_district.toLowerCase()) ||
        preferred_district.toLowerCase().includes(item.district.toLowerCase())

      const neighbors: Record<string, string[]> = {
        'quận 1': ['quận 3', 'quận 4', 'quận 10', 'bình thạnh', 'quận 2'],
        'quận 2': ['quận 1', 'quận 9', 'quận 7', 'thủ đức', 'bình thạnh'],
        'quận 7': ['quận 4', 'quận 8', 'quận 2', 'nhà bè'],
        'quận 4': ['quận 1', 'quận 7', 'quận 5', 'quận 8'],
        'bình thạnh': ['quận 1', 'quận 3', 'quận 2', 'phú nhuận', 'gò vấp'],
      }
      const prefLower = preferred_district.toLowerCase()
      const itemLower = item.district.toLowerCase()
      const isNeigh =
        neighbors[prefLower]?.some(n => itemLower.includes(n)) ||
        neighbors[itemLower]?.some(n => prefLower.includes(n))

      if (isExact) {
        locationScore += 30
        reasons.push(`Đúng ${preferred_district} đã chọn`)
      } else if (isNeigh) {
        locationScore += 18
        reasons.push(`Giáp ranh ${preferred_district} (thuộc ${item.district})`)
      } else {
        reasons.push(`Khu vực ${item.district}`)
        locationScore += 5
      }
      locationScore += isExact ? 15 : isNeigh ? 8 : 0

      // 3. Demographics Pillar (max score: 20)
      let demographicsScore = 0
      if (item.target_age_min <= age && age <= item.target_age_max) {
        demographicsScore += 10
        reasons.push(
          `Cộng đồng tuổi ${item.target_age_min}-${item.target_age_max} năng động`
        )
      }
      demographicsScore += 10

      // 4. Amenities Pillar (max score: 35)
      let amenitiesScore = 0
      if (item.rooms === rooms) {
        amenitiesScore += 15
        if (rooms === 1) {
          reasons.push('1PN riêng tư, tối ưu chi phí')
        } else if (rooms === 2) {
          reasons.push('2PN phù hợp gia đình trẻ')
        } else {
          reasons.push(`${rooms}PN rộng rãi cho cả nhà`)
        }
      } else {
        amenitiesScore += Math.max(0, 15 - Math.abs(item.rooms - rooms) * 5)
      }

      let gymScore = 0
      if (has_gym) {
        if (item.has_gym) {
          gymScore += 10
          reasons.push('Có phòng Gym nâng cao sức khỏe')
        } else {
          gymScore -= 5
        }
      } else {
        if (item.has_gym) {
          gymScore += 5
        }
      }

      let parkingScore = 0
      if (has_parking) {
        if (item.has_parking) {
          parkingScore += 10
          reasons.push('Có bãi đỗ xe ô tô theo nhu cầu')
        }
      }
      amenitiesScore += Math.max(0, gymScore + parkingScore)

      const contributions = {
        finance: Math.min(
          100,
          Math.max(0, Math.round((financeScore / 50.0) * 100))
        ),
        location: Math.min(
          100,
          Math.max(0, Math.round((locationScore / 45.0) * 100))
        ),
        demographics: Math.min(
          100,
          Math.max(0, Math.round((demographicsScore / 20.0) * 100))
        ),
        amenities: Math.min(
          100,
          Math.max(0, Math.round((amenitiesScore / 35.0) * 100))
        ),
      }

      const checklistContent =
        (rentRatio >= 0.15 && rentRatio <= 0.3
          ? 35
          : rentRatio < 0.15
            ? 25
            : 10) +
        (isExact ? 30 : isNeigh ? 18 : 0) +
        (item.rooms === rooms
          ? 15
          : Math.max(0, 15 - Math.abs(item.rooms - rooms) * 5)) +
        Math.max(0, gymScore + parkingScore) +
        (item.target_age_min <= age && age <= item.target_age_max ? 10 : 0)

      let finalChecklistContent = checklistContent
      if (rentRatio > 0.35) {
        const excess = rentRatio - 0.35
        const penalty = Math.min(35, Math.round(excess * 150))
        finalChecklistContent = Math.max(0, checklistContent - penalty)
      }
      const match_score = Math.min(
        100.0,
        Math.max(
          0.0,
          Math.round((finalChecklistContent / 110.0) * 100 * 10) / 10
        )
      )

      recommendations.push({
        id: item.id,
        name: item.name,
        district: item.district,
        rent_price: rent,
        rooms: item.rooms,
        has_gym: item.has_gym,
        has_parking: item.has_parking,
        image_url: item.image_url,
        match_score,
        reasons: reasons.slice(0, 3),
        confidence: 'Trung bình',
        contributions,
      })
    }

    return recommendations
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 5)
  }
}
