import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { LegalSource } from './schemas/legal-source.schema'
import { PlatformRegulation } from './schemas/platform-regulation.schema'
import {
  buildSeedLegalSources,
  buildSeedPlatformRegulations,
} from './legal-sources.seed-data'
import {
  toLegalSourceResponse,
  toPublicLegalSourceResponse,
  type CreateLegalSourceDto,
  type PublicLegalSourceResponse,
  type LegalSourceResponse,
  type UpdateLegalSourceDto,
} from './dto/legal-source.dto'

const BY_ORDER = { order: 'ASC' } as const

@Injectable()
export class LegalSourcesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LegalSourcesService.name)

  constructor(
    @InjectRepository(LegalSource)
    private readonly sourceRepository: Repository<LegalSource>,
    @InjectRepository(PlatformRegulation)
    private readonly regulationRepository: Repository<PlatformRegulation>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedIfEmpty()
  }

  /** Seed từng collection độc lập, chỉ khi collection đó đang rỗng */
  async seedIfEmpty(): Promise<void> {
    if ((await this.sourceRepository.count()) === 0) {
      const sources = buildSeedLegalSources()
      await this.sourceRepository.save(
        sources.map(s => this.sourceRepository.create(s))
      )
      this.logger.log(`Seeded ${sources.length} legal sources`)
    }
    if ((await this.regulationRepository.count()) === 0) {
      const regulations = buildSeedPlatformRegulations()
      await this.regulationRepository.save(
        regulations.map(r => this.regulationRepository.create(r))
      )
      this.logger.log(`Seeded ${regulations.length} platform regulations`)
    }
  }

  async findPublic(panel?: 'contract'): Promise<PublicLegalSourceResponse[]> {
    const where =
      panel === 'contract'
        ? { isActive: true, showInContractPanel: true }
        : { isActive: true }
    const sources = await this.sourceRepository.find({ where, order: BY_ORDER })
    return sources.map(toPublicLegalSourceResponse)
  }

  async findPublicByKey(key: string): Promise<PublicLegalSourceResponse> {
    const source = await this.sourceRepository.findOne({
      where: { key, isActive: true },
    })
    if (!source) throw new NotFoundException('Không tìm thấy nguồn pháp lý')
    return toPublicLegalSourceResponse(source)
  }

  async findAllAdmin(): Promise<LegalSourceResponse[]> {
    const sources = await this.sourceRepository.find({ order: BY_ORDER })
    return sources.map(toLegalSourceResponse)
  }

  async exists(key: string): Promise<boolean> {
    return (await this.sourceRepository.count({ where: { key } })) > 0
  }

  async create(
    dto: CreateLegalSourceDto,
    actorId: string
  ): Promise<LegalSourceResponse> {
    // `GET /legal-sources/admin` chiếm path này nên key `admin` không đọc public được
    if (dto.key === 'admin') {
      throw new BadRequestException('key "admin" là từ khoá dành riêng')
    }
    if (await this.exists(dto.key)) {
      throw new ConflictException(`Nguồn với key "${dto.key}" đã tồn tại`)
    }
    const nextOrder = (await this.sourceRepository.count()) + 1
    const saved = await this.sourceRepository.save(
      this.sourceRepository.create({
        ...dto,
        showInContractPanel: dto.showInContractPanel ?? false,
        isActive: dto.isActive ?? true,
        order: nextOrder,
        updatedBy: actorId,
      })
    )
    return toLegalSourceResponse(saved)
  }

  async update(
    key: string,
    dto: UpdateLegalSourceDto,
    actorId: string
  ): Promise<LegalSourceResponse> {
    const existing = await this.findEntity(key)
    const saved = await this.sourceRepository.save(
      this.sourceRepository.create({ ...existing, ...dto, updatedBy: actorId })
    )
    return toLegalSourceResponse(saved)
  }

  async remove(key: string): Promise<void> {
    const existing = await this.findEntity(key)
    const referencing = await this.regulationRepository.find({
      where: { linkedSourceKey: key },
    })
    if (referencing.length > 0) {
      const regulationCodes = referencing.map(r => r.code)
      throw new ConflictException({
        code: 'LEGAL_SOURCE_IN_USE',
        message: `Nguồn đang được quy định tham chiếu: ${regulationCodes.join(', ')}`,
        regulationCodes,
      })
    }
    await this.sourceRepository.delete(existing._id)
  }

  /** `keys` phải là hoán vị đúng của toàn bộ key hiện có */
  async reorder(
    keys: string[],
    actorId: string
  ): Promise<LegalSourceResponse[]> {
    const all = await this.sourceRepository.find()
    const byKey = new Map(all.map(s => [s.key, s]))
    const isPermutation =
      keys.length === all.length &&
      new Set(keys).size === keys.length &&
      keys.every(k => byKey.has(k))
    if (!isPermutation) {
      throw new BadRequestException(
        'Danh sách key phải chứa đúng và đủ các nguồn hiện có, không trùng lặp'
      )
    }
    // Không transaction: tập nhỏ, lỗi giữa chừng chỉ lệch thứ tự và reorder lại được.
    await Promise.all(
      keys.map((k, index) =>
        this.sourceRepository.update(byKey.get(k)!._id, {
          order: index + 1,
          updatedBy: actorId,
        })
      )
    )
    return this.findAllAdmin()
  }

  private async findEntity(key: string): Promise<LegalSource> {
    const source = await this.sourceRepository.findOne({ where: { key } })
    if (!source) throw new NotFoundException('Không tìm thấy nguồn pháp lý')
    return source
  }
}
