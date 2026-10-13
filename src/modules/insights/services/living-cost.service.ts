import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, FindOptionsWhere } from 'typeorm'
import { ObjectId } from 'mongodb'
import {
  LivingCostProfile,
  EstimateRange,
  AffordabilityStatus,
  ConfidenceLabel,
} from '../schemas/living-cost-profile.schema'
import {
  CalculateLivingCostDto,
  CreateLivingCostProfileDto,
} from '../dto/living-cost.dto'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'

export interface CalculationResult {
  monthlyRent: number
  serviceFee: number
  parkingFee: number
  internetFee: number
  electricityEstimate: EstimateRange
  waterEstimate: EstimateRange
  commuteEstimate: { distance?: number; mode?: string; monthlyFee?: number }
  oneTimeCosts: { name: string; amount: number }[]
  occupants: number
  monthlyBudget?: number
  totalEstimate: EstimateRange
  affordabilityStatus: AffordabilityStatus
  confidenceLabel: ConfidenceLabel
}

export interface ProfileListResult {
  items: LivingCostProfile[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class LivingCostService {
  private readonly logger = new Logger(LivingCostService.name)

  constructor(
    @InjectRepository(LivingCostProfile)
    private readonly profileRepository: Repository<LivingCostProfile>
  ) {}

  /**
   * Tính toán chi phí sinh hoạt (Pure calculation, không cần Auth)
   * [uc_living_cost_calculate]
   */
  calculateCost(dto: CalculateLivingCostDto): CalculationResult {
    const occupants = dto.occupants ?? 1
    const serviceFee = dto.serviceFee ?? 0
    const parkingFee = dto.parkingFee ?? 0
    const internetFee = dto.internetFee ?? 0
    const oneTimeCosts = dto.oneTimeCosts ?? []

    // Estimate Electricity based on occupants (VND/month)
    // Basic formula: ~250k - 500k per occupant
    const elecLow = occupants * 200000
    const elecMid = occupants * 350000
    const elecHigh = occupants * 600000
    const electricityEstimate: EstimateRange = {
      type: 'estimated',
      low: elecLow,
      mid: elecMid,
      high: elecHigh,
    }

    // Estimate Water based on occupants (VND/month)
    // Basic formula: ~60k - 150k per occupant
    const waterLow = occupants * 60000
    const waterMid = occupants * 100000
    const waterHigh = occupants * 160000
    const waterEstimate: EstimateRange = {
      type: 'estimated',
      low: waterLow,
      mid: waterMid,
      high: waterHigh,
    }

    const commuteFee = dto.commuteEstimate?.monthlyFee ?? 0
    const fixedMonthly =
      dto.monthlyRent + serviceFee + parkingFee + internetFee + commuteFee

    const totalLow = fixedMonthly + elecLow + waterLow
    const totalMid = fixedMonthly + elecMid + waterMid
    const totalHigh = fixedMonthly + elecHigh + waterHigh

    const totalEstimate: EstimateRange = {
      type: 'estimated',
      low: totalLow,
      mid: totalMid,
      high: totalHigh,
    }

    const affordabilityStatus = this.determineAffordability(
      totalMid,
      dto.monthlyBudget
    )
    const confidenceLabel: ConfidenceLabel = dto.apartmentId ? 'high' : 'medium'

    const result: CalculationResult = {
      monthlyRent: dto.monthlyRent,
      serviceFee,
      parkingFee,
      internetFee,
      electricityEstimate,
      waterEstimate,
      commuteEstimate: dto.commuteEstimate ?? {},
      oneTimeCosts,
      occupants,
      totalEstimate,
      affordabilityStatus,
      confidenceLabel,
    }
    if (dto.monthlyBudget !== undefined) {
      result.monthlyBudget = dto.monthlyBudget
    }

    return result
  }

  /**
   * Lưu hồ sơ chi phí của user
   */
  async saveProfile(
    userId: string,
    dto: CreateLivingCostProfileDto
  ): Promise<LivingCostProfile> {
    this.logger.log(
      `Saving living cost profile "${dto.name}" for user ${userId}`
    )

    const calc = this.calculateCost(dto)

    const profileData: Partial<LivingCostProfile> = {
      userId,
      name: dto.name,
      monthlyRent: calc.monthlyRent,
      serviceFee: calc.serviceFee,
      parkingFee: calc.parkingFee,
      internetFee: calc.internetFee,
      electricityEstimate: calc.electricityEstimate,
      waterEstimate: calc.waterEstimate,
      commuteEstimate: calc.commuteEstimate,
      oneTimeCosts: calc.oneTimeCosts,
      occupants: calc.occupants,
      totalEstimate: calc.totalEstimate,
      affordabilityStatus: calc.affordabilityStatus,
      confidenceLabel: calc.confidenceLabel,
    }
    if (dto.apartmentId) profileData.apartmentId = dto.apartmentId
    if (calc.monthlyBudget) profileData.monthlyBudget = calc.monthlyBudget

    const profile = this.profileRepository.create(profileData)
    return this.profileRepository.save(profile)
  }

  /**
   * Lấy danh sách hồ sơ chi phí của user
   */
  async getMyProfiles(
    userId: string,
    query: PaginationQueryDto
  ): Promise<ProfileListResult> {
    const allRecords = await this.profileRepository.find({
      where: { userId } as FindOptionsWhere<LivingCostProfile>,
      order: { createdAt: 'DESC' },
    })

    const total = allRecords.length
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const totalPages = Math.ceil(total / limit)
    const skip = (page - 1) * limit
    const items = allRecords.slice(skip, skip + limit)

    return { items, total, page, limit, totalPages }
  }

  /**
   * Xóa hồ sơ chi phí
   */
  async deleteProfile(profileId: string, userId: string): Promise<void> {
    const profile = await this.findProfileOrThrow(profileId, userId)
    await this.profileRepository.remove(profile)
  }

  // ─── Private Helpers ───────────────────────────────────

  private determineAffordability(
    totalEstimateMid: number,
    monthlyBudget?: number
  ): AffordabilityStatus {
    if (!monthlyBudget || monthlyBudget <= 0) return 'unknown'

    const ratio = totalEstimateMid / monthlyBudget
    if (ratio <= 0.85) return 'affordable'
    if (ratio <= 1.0) return 'tight'
    return 'over_budget'
  }

  private async findProfileOrThrow(
    profileId: string,
    userId: string
  ): Promise<LivingCostProfile> {
    let profile: LivingCostProfile | null = null
    try {
      profile = await this.profileRepository.findOne({
        where: { _id: new ObjectId(profileId) },
      })
    } catch {
      throw new NotFoundException(`ID hồ sơ không hợp lệ: ${profileId}`)
    }
    if (!profile) {
      throw new NotFoundException(`Không tìm thấy hồ sơ: ${profileId}`)
    }
    if (profile.userId !== userId) {
      throw new ForbiddenException('Bạn không có quyền truy cập hồ sơ này')
    }
    return profile
  }
}
