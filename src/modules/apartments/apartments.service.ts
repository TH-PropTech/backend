import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from './schemas/apartment.schema'

@Injectable()
export class ApartmentsService {
  private readonly logger = new Logger(ApartmentsService.name)

  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>
  ) {}

  // ── Lấy toàn bộ danh sách căn hộ ──
  async findAll(): Promise<Apartment[]> {
    this.logger.log('Fetching all apartments')
    return this.apartmentRepository.find({
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết căn hộ theo ID ──
  async findOne(id: string): Promise<Apartment> {
    this.logger.log(`Fetching apartment details for ID: ${id}`)
    try {
      const apartment = await this.apartmentRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!apartment) {
        throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
      }
      return apartment
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      throw new NotFoundException(
        `ID căn hộ không hợp lệ hoặc không tìm thấy: ${id}`
      )
    }
  }

  // ── Lấy danh sách căn hộ của một chủ nhà ──
  async findByLandlord(landlordId: string): Promise<Apartment[]> {
    this.logger.log(`Fetching apartments for landlord: ${landlordId}`)
    return this.apartmentRepository.find({
      where: { landlordId },
      order: { createdAt: 'DESC' },
    })
  }
}
