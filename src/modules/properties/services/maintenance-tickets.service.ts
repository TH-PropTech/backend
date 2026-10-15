import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Document, PushOperator } from 'mongodb'
import { ObjectId } from 'mongodb'
import { MongoRepository } from 'typeorm'
import {
  Apartment,
  MAX_MAINTENANCE_TICKETS,
  MAX_MAINTENANCE_TICKET_IMAGES,
  type MaintenanceTicketEntry,
} from '../schemas/apartment.schema'

export interface CreateMaintenanceTicketInput {
  tenantId: string
  description: string
  images?: string[]
}

/**
 * Phiếu bảo trì nhúng trong `Apartment.maintenanceTickets[]` (G-MNT).
 * Ghi chỉ bằng `updateOne` + `$push` nguyên tử có trần: `Apartment` bị `save`
 * nguyên document ở nhiều nơi nên không được đọc-rồi-ghi mảng này.
 */
@Injectable()
export class MaintenanceTicketsService {
  constructor(
    @InjectRepository(Apartment)
    private readonly apartmentRepository: MongoRepository<Apartment>
  ) {}

  async create(
    apartmentId: string,
    input: CreateMaintenanceTicketInput
  ): Promise<MaintenanceTicketEntry> {
    const _id = this.toObjectId(apartmentId)
    const images = input.images ?? []
    if (images.length > MAX_MAINTENANCE_TICKET_IMAGES) {
      throw new BadRequestException(
        `Mỗi phiếu bảo trì tối đa ${MAX_MAINTENANCE_TICKET_IMAGES} ảnh`
      )
    }
    const apartment = await this.apartmentRepository.findOne({
      where: { _id },
    })
    if (!apartment) throw new NotFoundException('Không tìm thấy căn hộ')

    const now = new Date()
    const entry: MaintenanceTicketEntry = {
      _id: new ObjectId(),
      tenantId: input.tenantId,
      propertyTitle: apartment.title,
      description: input.description,
      images,
      status: 'pending',
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const result = await this.apartmentRepository.updateOne(
      {
        _id,
        [`maintenanceTickets.${MAX_MAINTENANCE_TICKETS - 1}`]: {
          $exists: false,
        },
      },
      {
        $push: {
          maintenanceTickets: entry,
        } as unknown as PushOperator<Document>,
      }
    )
    if (result.matchedCount === 0) {
      throw new ConflictException(
        `Căn hộ đã đạt tối đa ${MAX_MAINTENANCE_TICKETS} phiếu bảo trì`
      )
    }
    return entry
  }

  /** Đọc thô (aggregate) vì entity nạp qua TypeORM đã bỏ `maintenanceTickets`. */
  async list(apartmentId: string): Promise<MaintenanceTicketEntry[]> {
    const _id = this.toObjectId(apartmentId)
    const rows = (await this.apartmentRepository
      .aggregate([{ $match: { _id } }, { $project: { maintenanceTickets: 1 } }])
      .toArray()) as Array<{ maintenanceTickets?: MaintenanceTicketEntry[] }>
    if (rows.length === 0) throw new NotFoundException('Không tìm thấy căn hộ')
    return rows[0]?.maintenanceTickets ?? []
  }

  private toObjectId(id: string): ObjectId {
    if (!ObjectId.isValid(id)) {
      throw new BadRequestException('Mã căn hộ không hợp lệ')
    }
    return new ObjectId(id)
  }
}
