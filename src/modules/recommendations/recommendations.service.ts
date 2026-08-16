import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../apartments/apartments.service'
import { Apartment } from '../apartments/schemas/apartment.schema'
import { RecommendDto } from './dto/recommend.dto'
import { FeedbackDto, FeedbackType } from './dto/feedback.dto'
import {
  RecommendationResult,
  FeedbackResponse,
  SyncResponse,
} from './interfaces/recommendation.interface'
import { NaiveBayesEngine } from './engine/naive-bayes.engine'
import { RecommendationHistory } from './schemas/recommendation-history.schema'
import {
  BuildingRecord,
  TrainingRecord,
  UserProfile,
} from './engine/naive-bayes.types'

@Injectable()
export class RecommendationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecommendationsService.name)
  private isModelTrained = false

  constructor(
    @InjectRepository(RecommendationHistory)
    private readonly historyRepository: Repository<RecommendationHistory>,
    private readonly apartmentsService: ApartmentsService,
    private readonly nbEngine: NaiveBayesEngine
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.logger.log('Initializing Native Naive Bayes recommendation model...')
      await this.retrainModel()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Failed to initialize recommendation model on bootstrap: ${msg}`
      )
    }
  }

  /**
   * Maps an Apartment entity into a BuildingRecord for the Naive Bayes engine.
   */
  private mapApartmentToBuilding(apt: Apartment): BuildingRecord {
    const amenities = (apt.amenities || []).map(a => a.toLowerCase())
    const price = apt.priceMonthly || 0
    const demo = this.nbEngine.inferDemographics(price)

    const hasGym = amenities.some(
      a => a.includes('gym') || a.includes('bể bơi') || a.includes('pool')
    )
      ? 1
      : 0

    const hasParking = amenities.some(
      a =>
        a.includes('đỗ xe') ||
        a.includes('parking') ||
        a.includes('bãi đỗ') ||
        a.includes('xe')
    )
      ? 1
      : 0

    const aptId = apt._id ? apt._id.toString() : ''
    const title =
      apt.buildingName || apt.projectName || apt.title || 'Căn hộ chung cư'

    return {
      id: aptId,
      name: title,
      district: apt.district || 'TP.HCM',
      rent_price: price,
      min_income: demo.minIncome,
      target_age_min: demo.targetAgeMin,
      target_age_max: demo.targetAgeMax,
      rooms: apt.bedrooms || 1,
      has_gym: hasGym,
      has_parking: hasParking,
      image_url:
        (apt.gallery && apt.gallery.length > 0 ? apt.gallery[0] : '') || '',
    }
  }

  /**
   * Retrains the Naive Bayes engine using real database apartments and historical records.
   */
  public async retrainModel(): Promise<{
    buildingCount: number
    historyRecords: number
  }> {
    const allApartments = await this.apartmentsService.findAll()
    const availableApartments = allApartments.filter(
      apt => apt.status === 'available'
    )

    const buildingRecords: BuildingRecord[] = availableApartments.map(apt =>
      this.mapApartmentToBuilding(apt)
    )

    const dbHistories = await this.historyRepository.find()
    const trainingRecords: TrainingRecord[] = dbHistories.map(h => ({
      user_age: h.userAge,
      user_income: h.userIncome,
      preferred_district: h.preferredDistrict,
      preferred_bedrooms: h.preferredBedrooms,
      requires_gym: h.requiresGym,
      requires_parking: h.requiresParking,
      rented_apartment_id: h.rentedApartmentId,
    }))

    this.nbEngine.train(buildingRecords, trainingRecords)
    this.isModelTrained = true

    this.logger.log(
      `Model retrained: ${buildingRecords.length} available apartments, ${trainingRecords.length} history records.`
    )

    return {
      buildingCount: buildingRecords.length,
      historyRecords: trainingRecords.length,
    }
  }

  /**
   * Main recommendation entry point.
   */
  async recommend(dto: RecommendDto): Promise<RecommendationResult[]> {
    if (!this.isModelTrained) {
      await this.retrainModel()
    }

    const userProfile: UserProfile = {
      age: dto.age,
      income: dto.income,
      preferred_district: dto.preferred_district,
      rooms: dto.rooms,
      has_gym: Boolean(dto.has_gym),
      has_parking: Boolean(dto.has_parking),
    }

    const recommendations = this.nbEngine.recommend(userProfile, 5)

    return recommendations.map(rec => ({
      id: rec.id,
      name: rec.name,
      district: rec.district,
      rent_price: rec.rent_price,
      rooms: rec.rooms,
      has_gym: rec.has_gym,
      has_parking: rec.has_parking,
      image_url: rec.image_url,
      match_score: rec.match_score,
      reasons: rec.reasons,
      confidence: rec.confidence,
      contributions: rec.contributions,
    }))
  }

  /**
   * Records user feedback and performs online learning.
   */
  async feedback(dto: FeedbackDto): Promise<FeedbackResponse> {
    if (dto.feedback_type === FeedbackType.LIKE) {
      const historyEntity = this.historyRepository.create({
        userAge: dto.age,
        userIncome: dto.income,
        preferredDistrict: dto.preferred_district,
        preferredBedrooms: dto.rooms,
        requiresGym: dto.has_gym ? 1 : 0,
        requiresParking: dto.has_parking ? 1 : 0,
        rentedApartmentId: dto.building_id,
        satisfactionScore: 5.0,
      })

      await this.historyRepository.save(historyEntity)
      const { historyRecords } = await this.retrainModel()

      return {
        status: 'success',
        message:
          "Feedback 'like' recorded successfully and model retrained on-the-fly.",
        history_records: historyRecords,
      }
    }

    const currentCount = await this.historyRepository.count()
    return {
      status: 'success',
      message: "Feedback 'dislike' recorded successfully.",
      history_records: currentCount,
    }
  }

  /**
   * Admin endpoint to sync data and trigger retraining.
   */
  async sync(): Promise<SyncResponse> {
    const { buildingCount } = await this.retrainModel()
    return {
      status: 'success',
      message: 'Apartment data synced and model retrained successfully',
      apartments_loaded: buildingCount,
    }
  }
}
