import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Building } from '../schemas/building.schema'
import { CreateBuildingDto } from '../dto/create-building.dto'

@Injectable()
export class BuildingsService {
  private readonly logger = new Logger(BuildingsService.name)

  constructor(
    @InjectRepository(Building)
    private readonly buildingRepository: Repository<Building>
  ) {}

  // ── Lấy toàn bộ danh sách tòa nhà ──
  async findAll(): Promise<Building[]> {
    this.logger.log('Fetching all buildings')
    return this.buildingRepository.find({
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy danh sách tòa nhà theo dự án ──
  async findByProject(projectId: string): Promise<Building[]> {
    this.logger.log(`Fetching buildings for project: ${projectId}`)
    return this.buildingRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết tòa nhà theo ID ──
  async findOne(id: string): Promise<Building> {
    this.logger.log(`Fetching building details for ID: ${id}`)
    try {
      const building = await this.buildingRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!building) {
        throw new NotFoundException(`Không tìm thấy tòa nhà với ID: ${id}`)
      }
      return building
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(
        `ID tòa nhà không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }

  // ── Tìm hoặc Tạo mới tòa nhà ──
  async findOrCreate(dto: CreateBuildingDto): Promise<Building> {
    this.logger.log(
      `Find or Create building: ${dto.name} under project: ${dto.projectId}`
    )
    const query: Record<string, unknown> = {
      name: { $regex: `^${dto.name}$`, $options: 'i' },
    }
    if (dto.projectId) {
      query.projectId = dto.projectId
    }
    const existing = await this.buildingRepository.findOne({
      where: query,
    })
    if (existing) {
      this.logger.log(
        `Found existing building: ${dto.name} with ID: ${existing._id.toString()}`
      )
      return existing
    }

    const building = this.buildingRepository.create({
      name: dto.name,
      projectId: dto.projectId || null,
      projectName: dto.projectName || '',
      description: dto.description || '',
      floorsCount: dto.floorsCount || 0,
      location: dto.location || '',
      city: dto.city || '',
      district: dto.district || '',
      amenities: dto.amenities || [],
      images: dto.images || [],
      images360: dto.images360 || [],
    })
    return this.buildingRepository.save(building)
  }
}
