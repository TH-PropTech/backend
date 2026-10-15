import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ConfigService } from '@nestjs/config'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../../services/apartments.service'
import { GroqVisionService } from './groq-vision.service'
import { ApartmentAnalysis } from '../schemas/apartment-analysis.schema'
import {
  toConditionAnalysisView,
  type ConditionAnalysisView,
} from '../schemas/apartment-analysis.mapper'

export interface AnalyzeConditionInput {
  apartmentId: string
  imageStorageKey: string
  image: Buffer
  mimeType: string
}

@Injectable()
export class ConditionAnalysisService {
  constructor(
    @InjectRepository(ApartmentAnalysis)
    private readonly repository: Repository<ApartmentAnalysis>,
    private readonly groqVisionService: GroqVisionService,
    private readonly configService: ConfigService,
    private readonly apartmentsService: ApartmentsService
  ) {}

  async analyze(
    userId: string,
    input: AnalyzeConditionInput
  ): Promise<ConditionAnalysisView> {
    await this.apartmentsService.findOne(input.apartmentId)
    const result = await this.groqVisionService.analyzeCondition(
      input.image,
      input.mimeType
    )
    const id = new ObjectId()
    const appUrl = this.configService.getOrThrow<string>('app.url')
    const analysis = this.repository.create({
      _id: id,
      kind: 'condition',
      userId,
      apartmentId: input.apartmentId,
      imageUrl: `${appUrl}/api/v1/condition-analyses/${id.toString()}/image`,
      imageStorageKey: input.imageStorageKey,
      findings: result.findings,
      overallCondition: result.overallCondition,
      checklist: result.checklist,
      model: result.model,
      isPrivate: true,
    })

    return toConditionAnalysisView(await this.repository.save(analysis))
  }

  async listMine(
    userId: string,
    apartmentId?: string
  ): Promise<ConditionAnalysisView[]> {
    const rows = await this.repository.find({
      where: {
        kind: 'condition',
        userId,
        ...(apartmentId ? { apartmentId } : {}),
      },
      order: { createdAt: 'DESC' },
    })
    return rows.map(toConditionAnalysisView)
  }

  async getMine(id: string, userId: string): Promise<ConditionAnalysisView> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Condition analysis not found')
    }

    const analysis = await this.repository.findOne({
      where: { _id: new ObjectId(id), kind: 'condition' },
    })
    if (!analysis) {
      throw new NotFoundException('Condition analysis not found')
    }
    if (analysis.userId !== userId) {
      throw new ForbiddenException(
        'Condition analysis does not belong to current user'
      )
    }

    return toConditionAnalysisView(analysis)
  }
}
