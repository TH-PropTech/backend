import { Injectable, Logger } from '@nestjs/common'
import {
  BuildingRecord,
  TrainingRecord,
  UserProfile,
  RecommendationOutput,
  BuildingModelParams,
  RecommendationContributions,
} from './naive-bayes.types'

@Injectable()
export class NaiveBayesEngine {
  private readonly logger = new Logger(NaiveBayesEngine.name)

  public static readonly DISTRICT_NEIGHBORS: Record<string, string[]> = {
    'Quận 1': ['Quận 3', 'Quận 4', 'Quận 5', 'Bình Thạnh', 'Quận 10', 'Quận 2'],
    'Quận 2': ['Bình Thạnh', 'Quận 9', 'Thủ Đức', 'Quận 7', 'Quận 4', 'Quận 1'],
    'Quận 3': ['Quận 1', 'Quận 10', 'Phú Nhuận', 'Tân Bình'],
    'Quận 4': ['Quận 1', 'Quận 7', 'Quận 2', 'Quận 5', 'Quận 8'],
    'Quận 7': ['Quận 4', 'Quận 8', 'Quận 2', 'Nhà Bè', 'Bình Chánh'],
    'Quận 8': ['Quận 7', 'Quận 5', 'Quận 6', 'Bình Tân', 'Quận 4'],
    'Quận 9': ['Quận 2', 'Thủ Đức'],
    'Quận 10': ['Quận 3', 'Quận 11', 'Quận 5', 'Tân Bình', 'Quận 1'],
    'Bình Thạnh': ['Quận 1', 'Quận 2', 'Phú Nhuận', 'Gò Vấp', 'Thủ Đức'],
    'Thủ Đức': ['Quận 2', 'Quận 9', 'Bình Thạnh', 'Gò Vấp'],
    'Bình Tân': ['Quận 6', 'Quận 8', 'Tân Phú', 'Bình Chánh'],
    'Gò Vấp': ['Bình Thạnh', 'Phú Nhuận', 'Quận 12', 'Tân Bình'],
    'Phú Nhuận': ['Quận 1', 'Quận 3', 'Bình Thạnh', 'Gò Vấp', 'Tân Bình'],
  }

  private buildings: BuildingRecord[] = []
  private history: TrainingRecord[] = []

  private priors: Record<string, number> = {}
  private buildingParams: Record<string, BuildingModelParams> = {}

  private districtVocabSize = 8
  private roomsVocabSize = 3
  private readonly gymVocabSize = 2
  private readonly parkingVocabSize = 2

  private isTrained = false

  public isNeighbor(d1?: string, d2?: string): boolean {
    if (!d1 || !d2) return false
    const d1Clean = d1.trim().toLowerCase()
    const d2Clean = d2.trim().toLowerCase()

    for (const [key, neighbors] of Object.entries(
      NaiveBayesEngine.DISTRICT_NEIGHBORS
    )) {
      if (key.trim().toLowerCase() === d1Clean) {
        return neighbors.some(n => n.trim().toLowerCase() === d2Clean)
      }
      if (key.trim().toLowerCase() === d2Clean) {
        return neighbors.some(n => n.trim().toLowerCase() === d1Clean)
      }
    }
    return false
  }

  public inferDemographics(price: number): {
    minIncome: number
    targetAgeMin: number
    targetAgeMax: number
  } {
    const minIncome = Math.round(price * 2.5)
    if (price <= 8_000_000) {
      return { minIncome, targetAgeMin: 20, targetAgeMax: 35 }
    } else if (price <= 15_000_000) {
      return { minIncome, targetAgeMin: 23, targetAgeMax: 45 }
    } else if (price <= 25_000_000) {
      return { minIncome, targetAgeMin: 25, targetAgeMax: 50 }
    }
    return { minIncome, targetAgeMin: 28, targetAgeMax: 60 }
  }

  public train(buildings: BuildingRecord[], history: TrainingRecord[]): void {
    this.buildings = buildings
    this.history = history
    this.priors = {}
    this.buildingParams = {}

    if (buildings.length === 0) {
      this.isTrained = false
      this.logger.warn('No buildings provided for training Naive Bayes.')
      return
    }

    const totalRecords = history.length
    const buildingIds = Array.from(new Set(buildings.map(b => b.id)))
    const numBuildings = buildingIds.length

    // Distinct vocabs from history
    const distinctDistricts = new Set(history.map(h => h.preferred_district))
    const distinctRooms = new Set(history.map(h => h.preferred_bedrooms))
    this.districtVocabSize = Math.max(distinctDistricts.size, 1)
    this.roomsVocabSize = Math.max(distinctRooms.size, 1)

    // Compute global statistics
    const globalAgeMean =
      totalRecords > 0
        ? history.reduce((sum, r) => sum + r.user_age, 0) / totalRecords
        : 30
    const globalAgeVar =
      totalRecords > 1
        ? history.reduce(
            (sum, r) => sum + Math.pow(r.user_age - globalAgeMean, 2),
            0
          ) /
          (totalRecords - 1)
        : 25
    const globalIncomeMean =
      totalRecords > 0
        ? history.reduce((sum, r) => sum + r.user_income, 0) / totalRecords
        : 25_000_000
    const globalIncomeVar =
      totalRecords > 1
        ? history.reduce(
            (sum, r) => sum + Math.pow(r.user_income - globalIncomeMean, 2),
            0
          ) /
          (totalRecords - 1)
        : 100_000_000_000_000

    // Group history by building ID
    const grouped = new Map<string, TrainingRecord[]>()
    for (const record of history) {
      const bId = record.rented_apartment_id
      const list = grouped.get(bId) || []
      list.push(record)
      grouped.set(bId, list)
    }

    const alpha = 1.0 // Laplace smoothing for prior

    for (const bId of buildingIds) {
      const bData = grouped.get(bId) || []
      const bCount = bData.length

      // Prior P(Building_i)
      this.priors[bId] =
        (bCount + alpha) / (totalRecords + alpha * numBuildings)

      if (bCount > 0) {
        // Continuous: Age
        const ageMean = bData.reduce((sum, r) => sum + r.user_age, 0) / bCount
        let ageVar =
          bCount > 1
            ? bData.reduce(
                (sum, r) => sum + Math.pow(r.user_age - ageMean, 2),
                0
              ) /
              (bCount - 1)
            : 1.0
        if (Number.isNaN(ageVar) || ageVar < 0.1) {
          ageVar = 1.0
        }

        // Continuous: Income
        const incomeMean =
          bData.reduce((sum, r) => sum + r.user_income, 0) / bCount
        let incomeVar =
          bCount > 1
            ? bData.reduce(
                (sum, r) => sum + Math.pow(r.user_income - incomeMean, 2),
                0
              ) /
              (bCount - 1)
            : globalIncomeVar
        if (Number.isNaN(incomeVar) || incomeVar < 100_000) {
          incomeVar = globalIncomeVar
        }

        // Categorical stats
        const distCounts: Record<string, number> = {}
        const roomCounts: Record<string, number> = {}
        const gymCounts: Record<string, number> = {}
        const parkingCounts: Record<string, number> = {}

        for (const r of bData) {
          distCounts[r.preferred_district] =
            (distCounts[r.preferred_district] || 0) + 1
          roomCounts[r.preferred_bedrooms] =
            (roomCounts[r.preferred_bedrooms] || 0) + 1
          gymCounts[r.requires_gym] = (gymCounts[r.requires_gym] || 0) + 1
          parkingCounts[r.requires_parking] =
            (parkingCounts[r.requires_parking] || 0) + 1
        }

        this.buildingParams[bId] = {
          prior: this.priors[bId],
          gaussian: {
            age: { mean: ageMean, var: ageVar },
            income: { mean: incomeMean, var: incomeVar },
          },
          categorical: {
            district: { counts: distCounts, total: bCount },
            rooms: { counts: roomCounts, total: bCount },
            gym: { counts: gymCounts, total: bCount },
            parking: { counts: parkingCounts, total: bCount },
          },
        }
      } else {
        // Fallback for buildings without prior history
        this.buildingParams[bId] = {
          prior: this.priors[bId],
          gaussian: {
            age: { mean: globalAgeMean, var: globalAgeVar },
            income: { mean: globalIncomeMean, var: globalIncomeVar },
          },
          categorical: {
            district: { counts: {}, total: 0 },
            rooms: { counts: {}, total: 0 },
            gym: { counts: {}, total: 0 },
            parking: { counts: {}, total: 0 },
          },
        }
      }
    }

    this.isTrained = true
    this.logger.log(
      `Naive Bayes trained successfully on ${totalRecords} history records across ${numBuildings} buildings.`
    )
  }

  public gaussianProbability(
    x: number,
    mean: number,
    variance: number
  ): number {
    if (variance <= 0) variance = 1.0
    const exponent = Math.exp(-Math.pow(x - mean, 2) / (2 * variance))
    const pdf = (1 / Math.sqrt(2 * Math.PI * variance)) * exponent
    return Math.max(pdf, 1e-9)
  }

  public categoricalProbability(
    value: string | number,
    stats: { counts: Record<string, number>; total: number },
    vocabSize: number,
    beta = 1.0
  ): number {
    const valCount = stats.counts[String(value)] || 0
    return (valCount + beta) / (stats.total + beta * Math.max(vocabSize, 1))
  }

  public recommend(
    userProfile: UserProfile,
    limit = 5
  ): RecommendationOutput[] {
    if (!this.isTrained || this.buildings.length === 0) {
      this.logger.warn('Recommender called without being trained.')
      return []
    }

    const {
      age: userAge,
      income: userIncome,
      preferred_district: prefDistrict,
      rooms: prefRooms,
      has_gym: userHasGym,
      has_parking: userHasParking,
    } = userProfile

    const prefGym = userHasGym ? 1 : 0
    const prefParking = userHasParking ? 1 : 0

    // Filter buildings exceeding 50% monthly income
    const validBuildings = this.buildings.filter(b => {
      const rent = Number(b.rent_price)
      if (rent > userIncome * 0.5) return false
      return b.id in this.buildingParams
    })

    if (validBuildings.length === 0) {
      return []
    }

    const logLikelihoods: Record<string, number> = {}
    const compProbs: Record<
      string,
      {
        pAge: number
        pIncome: number
        pDist: number
        pRooms: number
        pGym: number
        pParking: number
        ageVar: number
        incomeVar: number
      }
    > = {}

    // Compute log-likelihood for each valid building
    for (const b of validBuildings) {
      const bId = b.id
      const params = this.buildingParams[bId]
      if (!params) continue

      let logProb = Math.log(params.prior)

      // Continuous
      const ageStats = params.gaussian.age
      const pAge = this.gaussianProbability(
        userAge,
        ageStats.mean,
        ageStats.var
      )
      logProb += Math.log(pAge)

      const incomeStats = params.gaussian.income
      const pIncome = this.gaussianProbability(
        userIncome,
        incomeStats.mean,
        incomeStats.var
      )
      logProb += Math.log(pIncome)

      // Categorical
      const cat = params.categorical
      const pDist = this.categoricalProbability(
        prefDistrict,
        cat.district,
        this.districtVocabSize
      )
      logProb += Math.log(pDist)

      const pRooms = this.categoricalProbability(
        prefRooms,
        cat.rooms,
        this.roomsVocabSize
      )
      logProb += Math.log(pRooms)

      const pGym = this.categoricalProbability(
        prefGym,
        cat.gym,
        this.gymVocabSize
      )
      logProb += Math.log(pGym)

      const pParking = this.categoricalProbability(
        prefParking,
        cat.parking,
        this.parkingVocabSize
      )
      logProb += Math.log(pParking)

      logLikelihoods[bId] = logProb
      compProbs[bId] = {
        pAge,
        pIncome,
        pDist,
        pRooms,
        pGym,
        pParking,
        ageVar: ageStats.var,
        incomeVar: incomeStats.var,
      }
    }

    // Step 3: Normalize Log-Likelihoods
    const maxLog = Math.max(...Object.values(logLikelihoods))
    const relativeProbs: Record<string, number> = {}
    for (const [bId, logVal] of Object.entries(logLikelihoods)) {
      relativeProbs[bId] = Math.exp(logVal - maxLog)
    }

    // Step 4: Content-based Checklist Score & 4-Pillar breakdown
    const recommendations: RecommendationOutput[] = []

    for (const b of validBuildings) {
      const bId = b.id
      const rent = Number(b.rent_price)
      const probs = compProbs[bId]
      if (!probs) continue

      const reasons: string[] = []

      // 1. Finance Pillar (max score: 50)
      let financeScore = 0.0
      const rentRatio = rent / userIncome
      const rentPercentage = Math.round(rentRatio * 100)

      if (rentRatio >= 0.15 && rentRatio <= 0.3) {
        financeScore += 35
        reasons.push(`Giá thuê chỉ chiếm ${rentPercentage}% thu nhập`)
      } else if (rentRatio < 0.15) {
        financeScore += 25
        reasons.push(`Tiết kiệm tối đa (chỉ ${rentPercentage}% thu nhập)`)
      } else {
        if (rentRatio <= 0.35) {
          financeScore += 10
        }
        reasons.push(`Chi phí thuê khá cao (${rentPercentage}% thu nhập)`)
      }

      const maxIncomePdf = 1.0 / Math.sqrt(2 * Math.PI * probs.incomeVar)
      const incomeRatio = Math.min(1.0, probs.pIncome / maxIncomePdf)
      financeScore += incomeRatio * 15

      // 2. Location Pillar (max score: 45)
      let locationScore = 0.0
      const isExact =
        b.district.trim().toLowerCase() === prefDistrict.trim().toLowerCase()
      const isNeigh = this.isNeighbor(prefDistrict, b.district)

      if (isExact) {
        locationScore += 30
        reasons.push(`Đúng ${prefDistrict} đã chọn`)
      } else if (isNeigh) {
        locationScore += 18
        reasons.push(`Giáp ranh ${prefDistrict} (thuộc ${b.district})`)
      } else {
        reasons.push(`Khu vực ${b.district}`)
      }
      locationScore += probs.pDist * 15

      // 3. Demographics Pillar (max score: 20)
      let demographicsScore = 0.0
      if (b.target_age_min <= userAge && userAge <= b.target_age_max) {
        demographicsScore += 10
        reasons.push(
          `Cộng đồng tuổi ${b.target_age_min}-${b.target_age_max} năng động`
        )
      }
      const maxAgePdf = 1.0 / Math.sqrt(2 * Math.PI * probs.ageVar)
      const ageRatio = Math.min(1.0, probs.pAge / maxAgePdf)
      demographicsScore += ageRatio * 10

      // 4. Amenities Pillar (max score: 35)
      let amenitiesScore = 0.0
      if (Number(b.rooms) === Number(prefRooms)) {
        amenitiesScore += 15
        if (Number(prefRooms) === 1) {
          reasons.push('1PN riêng tư, tối ưu chi phí')
        } else if (Number(prefRooms) === 2) {
          reasons.push('2PN phù hợp gia đình trẻ')
        } else {
          reasons.push(`${prefRooms}PN rộng rãi cho cả nhà`)
        }
      } else {
        amenitiesScore += Math.max(
          0,
          15 - Math.abs(Number(b.rooms) - Number(prefRooms)) * 5
        )
      }

      let gymScore = 0.0
      if (prefGym === 1) {
        if (Number(b.has_gym) === 1) {
          gymScore += 10
          reasons.push('Có phòng Gym nâng cao sức khỏe')
        } else {
          gymScore -= 5
        }
      } else {
        if (Number(b.has_gym) === 1) {
          gymScore += 5
        }
      }

      let parkingScore = 0.0
      if (prefParking === 1) {
        if (Number(b.has_parking) === 1) {
          parkingScore += 10
          reasons.push('Có bãi đỗ xe ô tô theo nhu cầu')
        }
      }
      amenitiesScore += Math.max(0, gymScore + parkingScore)

      // Compute contributions
      const contributions: RecommendationContributions = {
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

      // Checklist content score
      let checklistContent =
        (rentRatio >= 0.15 && rentRatio <= 0.3
          ? 35
          : rentRatio < 0.15
            ? 25
            : 10) +
        (isExact ? 30 : isNeigh ? 18 : 0) +
        (Number(b.rooms) === Number(prefRooms)
          ? 15
          : Math.max(
              0,
              15 - Math.abs(Number(b.rooms) - Number(prefRooms)) * 5
            )) +
        Math.max(0, gymScore + parkingScore) +
        (b.target_age_min <= userAge && userAge <= b.target_age_max ? 10 : 0)

      if (rentRatio > 0.35) {
        const excess = rentRatio - 0.35
        const penalty = Math.min(35, Math.round(excess * 150))
        checklistContent = Math.max(0, checklistContent - penalty)
      }
      const checklistPercentage = (checklistContent / 110.0) * 100

      // Naive Bayes percentage
      const nbPercentage = (relativeProbs[bId] || 0.0) * 100

      // Hybrid match score
      let finalMatch = 0.5 * nbPercentage + 0.5 * checklistPercentage
      finalMatch = Math.min(
        100.0,
        Math.max(0.0, Math.round(finalMatch * 10) / 10)
      )

      if (nbPercentage > 70) {
        reasons.push('Hồ sơ khớp với xu hướng khách thuê cùng phân khúc')
      }

      const historyCount =
        this.buildingParams[bId]?.categorical?.district?.total || 0
      const confidence: 'Cao' | 'Trung bình' | 'Thấp' =
        historyCount >= 150 ? 'Cao' : historyCount >= 20 ? 'Trung bình' : 'Thấp'

      recommendations.push({
        id: bId,
        name: b.name,
        district: b.district,
        rent_price: rent,
        rooms: Number(b.rooms),
        has_gym: Number(b.has_gym) === 1,
        has_parking: Number(b.has_parking) === 1,
        image_url: b.image_url,
        match_score: finalMatch,
        reasons: reasons.slice(0, 4),
        confidence,
        contributions,
      })
    }

    return recommendations
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit)
  }
}
