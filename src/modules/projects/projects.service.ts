import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Project } from './schemas/project.schema'

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>
  ) {}

  // ── Lấy toàn bộ danh sách dự án ──
  async findAll(): Promise<Project[]> {
    this.logger.log('Fetching all projects')
    return this.projectRepository.find({
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết dự án theo ID ──
  async findOne(id: string): Promise<Project> {
    this.logger.log(`Fetching project details for ID: ${id}`)
    try {
      const project = await this.projectRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!project) {
        throw new NotFoundException(`Không tìm thấy dự án với ID: ${id}`)
      }
      return project
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(
        `ID dự án không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }
}
