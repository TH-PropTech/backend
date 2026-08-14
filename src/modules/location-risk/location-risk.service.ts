import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../apartments/apartments.service'
import {
  CreateRiskLayerDto,
  UpdateRiskLayerDto,
} from './dto/create-risk-layer.dto'
import { RiskLayerData } from './schemas/risk-layer-data.schema'

export interface RiskScoreResult {
  status: 'available' | 'insufficient_data'
  score: number | null
  district: string
  layers: RiskLayerData[]
}

@Injectable()
export class LocationRiskService {
  constructor(
    @InjectRepository(RiskLayerData)
    private readonly repository: Repository<RiskLayerData>,
    private readonly apartmentsService: ApartmentsService
  ) {}

  async getLayersForDistrict(district: string): Promise<RiskLayerData[]> {
    return this.repository.find({
      where: { district },
      order: { timestamp: 'DESC' },
    })
  }

  async getRiskScore(
    apartmentId: string,
    weights?: Record<string, number>
  ): Promise<RiskScoreResult> {
    this.assertWeights(weights)
    const apartment = await this.apartmentsService.findOne(apartmentId)
    const layers = await this.getLayersForDistrict(apartment.district)
    const weightedLayers = layers
      .map(layer => ({
        layer,
        weight: weights?.[layer.layerType] ?? 1,
      }))
      .filter(item => item.weight > 0)

    if (weightedLayers.length === 0) {
      return {
        status: 'insufficient_data',
        score: null,
        district: apartment.district,
        layers,
      }
    }

    const totalWeight = weightedLayers.reduce(
      (total, item) => total + item.weight,
      0
    )
    const score = weightedLayers.reduce(
      (total, item) => total + item.layer.severity * item.weight,
      0
    )

    return {
      status: 'available',
      score: Math.round((score / totalWeight) * 10) / 10,
      district: apartment.district,
      layers,
    }
  }

  async create(dto: CreateRiskLayerDto): Promise<RiskLayerData> {
    return this.repository.save(
      this.repository.create({
        ...dto,
        district: dto.district.trim(),
        layerType: dto.layerType.trim(),
        source: dto.source.trim(),
        geoJson: dto.geoJson ?? null,
      })
    )
  }

  async update(id: string, dto: UpdateRiskLayerDto): Promise<RiskLayerData> {
    const layer = await this.findOrThrow(id)
    Object.assign(layer, dto)
    if (dto.district !== undefined) layer.district = dto.district.trim()
    if (dto.layerType !== undefined) layer.layerType = dto.layerType.trim()
    if (dto.source !== undefined) layer.source = dto.source.trim()
    return this.repository.save(layer)
  }

  async delete(id: string): Promise<void> {
    await this.repository.remove(await this.findOrThrow(id))
  }

  private assertWeights(weights?: Record<string, number>): void {
    if (!weights) return
    const invalid = Object.values(weights).some(
      weight =>
        typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0
    )
    if (invalid) {
      throw new BadRequestException(
        'Risk weights must be finite and non-negative'
      )
    }
  }

  private async findOrThrow(id: string): Promise<RiskLayerData> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Risk layer not found')
    }
    const layer = await this.repository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!layer) throw new NotFoundException('Risk layer not found')
    return layer
  }
}
