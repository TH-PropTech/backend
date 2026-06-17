import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'

@Injectable()
export class ApartmentsService {
  private readonly logger = new Logger(ApartmentsService.name)

  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>
  ) {}

  // ── Lấy toàn bộ danh sách căn hộ ──
  async findAll(): Promise<Apartment[]> {
    this.logger.log('Fetching all apartments')
    return this.apartmentRepository.find({
      order: { createdAt: 'DESC' },
    })
  }

  // ── Lấy chi tiết căn hộ theo ID ──
  async findOne(id: string): Promise<Apartment & { landlord?: User | null }> {
    this.logger.log(`Fetching apartment details for ID: ${id}`)
    try {
      const apartment = await this.apartmentRepository.findOne({
        where: { _id: new ObjectId(id) },
      })
      if (!apartment) {
        throw new NotFoundException(`Không tìm thấy căn hộ với ID: ${id}`)
      }

      let landlord: User | null = null
      if (apartment.landlordId) {
        try {
          landlord = await this.userRepository.findOne({
            where: { _id: new ObjectId(apartment.landlordId) },
          })
        } catch (err) {
          this.logger.warn(
            `Failed to fetch landlord: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      return {
        ...apartment,
        landlord,
      }
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
