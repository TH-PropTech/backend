import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { LegalSource } from '../../legal/schemas/legal-source.schema'
import { PlatformRegulation } from '../../legal/schemas/platform-regulation.schema'
import {
  toPlatformRegulationResponse,
  type CreatePlatformRegulationDto,
  type PlatformRegulationResponse,
  type UpdatePlatformRegulationDto,
} from '../../legal/dto/platform-regulation.dto'

@Injectable()
export class PlatformRegulationsService {
  constructor(
    @InjectRepository(PlatformRegulation)
    private readonly regulationRepository: Repository<PlatformRegulation>,
    @InjectRepository(LegalSource)
    private readonly sourceRepository: Repository<LegalSource>
  ) {}

  async findAllAdmin(): Promise<PlatformRegulationResponse[]> {
    const regulations = await this.regulationRepository.find({
      order: { order: 'ASC' },
    })
    return regulations.map(toPlatformRegulationResponse)
  }

  async create(
    dto: CreatePlatformRegulationDto,
    actorId: string
  ): Promise<PlatformRegulationResponse> {
    await this.assertCodeAvailable(dto.code)
    await this.assertLinkedSourceExists(dto.linkedSourceKey)
    const nextOrder = (await this.regulationRepository.count()) + 1
    const saved = await this.regulationRepository.save(
      this.regulationRepository.create({
        ...dto,
        linkedSourceKey: dto.linkedSourceKey ?? null,
        isActive: dto.isActive ?? true,
        isDefault: false,
        order: nextOrder,
        updatedBy: actorId,
      })
    )
    return toPlatformRegulationResponse(saved)
  }

  async update(
    id: string,
    dto: UpdatePlatformRegulationDto,
    actorId: string
  ): Promise<PlatformRegulationResponse> {
    const existing = await this.findEntity(id)
    if (dto.code !== undefined && dto.code !== existing.code) {
      await this.assertCodeAvailable(dto.code)
    }
    await this.assertLinkedSourceExists(dto.linkedSourceKey)
    const saved = await this.regulationRepository.save(
      this.regulationRepository.create({
        ...existing,
        ...dto,
        updatedBy: actorId,
      })
    )
    return toPlatformRegulationResponse(saved)
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findEntity(id)
    await this.regulationRepository.delete(existing._id)
  }

  /** `ids` phải là hoán vị đúng của toàn bộ quy định hiện có */
  async reorder(
    ids: string[],
    actorId: string
  ): Promise<PlatformRegulationResponse[]> {
    const all = await this.regulationRepository.find()
    const byId = new Map(all.map(r => [r._id.toString(), r]))
    const isPermutation =
      ids.length === all.length &&
      new Set(ids).size === ids.length &&
      ids.every(id => byId.has(id))
    if (!isPermutation) {
      throw new BadRequestException(
        'Danh sách id phải chứa đúng và đủ các quy định hiện có, không trùng lặp'
      )
    }
    await Promise.all(
      ids.map((id, index) =>
        this.regulationRepository.update(byId.get(id)!._id, {
          order: index + 1,
          updatedBy: actorId,
        })
      )
    )
    return this.findAllAdmin()
  }

  private async findEntity(id: string): Promise<PlatformRegulation> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Không tìm thấy quy định')
    }
    const regulation = await this.regulationRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!regulation) throw new NotFoundException('Không tìm thấy quy định')
    return regulation
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    if ((await this.regulationRepository.count({ where: { code } })) > 0) {
      throw new ConflictException(`Mã quy định "${code}" đã tồn tại`)
    }
  }

  private async assertLinkedSourceExists(
    key: string | null | undefined
  ): Promise<void> {
    if (!key) return
    if ((await this.sourceRepository.count({ where: { key } })) === 0) {
      throw new BadRequestException({
        code: 'LINKED_SOURCE_NOT_FOUND',
        message: `Nguồn pháp lý "${key}" không tồn tại`,
      })
    }
  }
}
