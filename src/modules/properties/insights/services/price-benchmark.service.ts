import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Apartment } from '../../schemas/apartment.schema'
import type { BenchmarkQueryDto } from '../dto/benchmark-query.dto'
import type {
  BenchmarkClassification,
  BenchmarkConfidence,
  BenchmarkResponseDto,
} from '../dto/benchmark-response.dto'

const MINIMUM_SAMPLE_SIZE = 5
const AREA_TOLERANCE = 0.2
const OUTLIER_FACTOR = 1.5

@Injectable()
export class PriceBenchmarkService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>
  ) {}

  /** Calculate an explainable rental benchmark. [uc_customer_apartment] [uc_search] */
  async calculateBenchmark(
    query: BenchmarkQueryDto
  ): Promise<BenchmarkResponseDto> {
    const where: {
      status: Apartment['status']
      district: string
      bedrooms: number
      furniture?: string
    } = {
      status: 'available',
      district: query.district,
      bedrooms: query.bedrooms,
    }
    if (query.furniture) where.furniture = query.furniture

    const records = await this.apartmentRepository.find({
      where,
      order: { updatedAt: 'DESC' },
    })
    const targetArea = query.area
    const areaFiltered =
      targetArea === undefined
        ? records
        : records.filter(record => {
            const minimum = targetArea * (1 - AREA_TOLERANCE)
            const maximum = targetArea * (1 + AREA_TOLERANCE)
            return record.area >= minimum && record.area <= maximum
          })
    const rawPrices = areaFiltered
      .map(record => record.priceMonthly)
      .filter(price => Number.isFinite(price) && price > 0)
      .sort((left, right) => left - right)

    if (rawPrices.length < MINIMUM_SAMPLE_SIZE) {
      return this.insufficientResult(query, rawPrices.length, 0)
    }

    const initialP25 = this.percentile(rawPrices, 0.25)
    const initialP75 = this.percentile(rawPrices, 0.75)
    const iqr = initialP75 - initialP25
    const lowerBound = initialP25 - OUTLIER_FACTOR * iqr
    const upperBound = initialP75 + OUTLIER_FACTOR * iqr
    const prices = rawPrices.filter(
      price => price >= lowerBound && price <= upperBound
    )
    const excludedOutliers = rawPrices.length - prices.length

    if (prices.length < MINIMUM_SAMPLE_SIZE) {
      return this.insufficientResult(query, prices.length, excludedOutliers)
    }

    const p25 = this.percentile(prices, 0.25)
    const median = this.percentile(prices, 0.5)
    const p75 = this.percentile(prices, 0.75)

    return {
      median,
      p25,
      p75,
      range: { min: prices[0] ?? 0, max: prices[prices.length - 1] ?? 0 },
      sampleCount: prices.length,
      excludedOutliers,
      confidence: this.getConfidence(prices.length),
      classification: this.classify(query.priceMonthly, p25, p75),
      calculatedAt: new Date().toISOString(),
      criteria: this.toCriteria(query),
    }
  }

  private percentile(sortedValues: readonly number[], ratio: number): number {
    const position = (sortedValues.length - 1) * ratio
    const lowerIndex = Math.floor(position)
    const upperIndex = Math.ceil(position)
    const lower = sortedValues[lowerIndex] ?? 0
    const upper = sortedValues[upperIndex] ?? lower
    return lower + (upper - lower) * (position - lowerIndex)
  }

  private classify(
    targetPrice: number,
    p25: number,
    p75: number
  ): BenchmarkClassification {
    if (targetPrice < p25) return 'below_market'
    if (targetPrice > p75) return 'above_market'
    return 'fair_range'
  }

  private getConfidence(sampleCount: number): BenchmarkConfidence {
    if (sampleCount >= 20) return 'high'
    if (sampleCount >= 10) return 'medium'
    return 'low'
  }

  private insufficientResult(
    query: BenchmarkQueryDto,
    sampleCount: number,
    excludedOutliers: number
  ): BenchmarkResponseDto {
    return {
      median: null,
      p25: null,
      p75: null,
      range: null,
      sampleCount,
      excludedOutliers,
      confidence: 'insufficient',
      classification: 'not_enough_data',
      calculatedAt: new Date().toISOString(),
      criteria: this.toCriteria(query),
    }
  }

  private toCriteria(
    query: BenchmarkQueryDto
  ): BenchmarkResponseDto['criteria'] {
    return {
      district: query.district,
      bedrooms: query.bedrooms,
      area: query.area ?? null,
      furniture: query.furniture ?? null,
    }
  }
}
