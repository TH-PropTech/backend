import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../apartments/apartments.service'
import { CreateRentalApplicationDto } from './dto/create-rental-application.dto'
import { RentalApplicationQueryDto } from './dto/rental-application-query.dto'
import { RespondRentalApplicationDto } from './dto/respond-rental-application.dto'
import { RentalApplication } from './schemas/rental-application.schema'

export interface RentalApplicationListResult {
  items: RentalApplication[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class RentalApplicationsService {
  constructor(
    @InjectRepository(RentalApplication)
    private readonly repository: Repository<RentalApplication>,
    private readonly apartmentsService: ApartmentsService
  ) {}

  async create(
    tenantId: string,
    dto: CreateRentalApplicationDto
  ): Promise<RentalApplication> {
    const apartment = await this.apartmentsService.findOne(dto.apartmentId)
    if (apartment.landlordId === tenantId)
      throw new BadRequestException('Cannot apply to your own listing')
    const moveInDate = new Date(dto.moveInDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (moveInDate < today)
      throw new BadRequestException('Move-in date must not be in the past')
    const duplicate = await this.repository.findOne({
      where: { tenantId, apartmentId: dto.apartmentId, status: 'pending' },
    })
    if (duplicate)
      throw new ConflictException('A pending application already exists')
    return this.repository.save(
      this.repository.create({
        tenantId,
        apartmentId: dto.apartmentId,
        landlordId: apartment.landlordId,
        occupants: dto.occupants,
        moveInDate,
        leaseDurationMonths: dto.leaseDurationMonths,
        occupation: dto.occupation,
        hasPets: dto.hasPets,
        notes: dto.notes ?? null,
        status: 'pending',
        reasonCode: null,
        actorId: null,
        actorTimestamp: null,
      })
    )
  }

  async getMine(
    tenantId: string,
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.list({ tenantId }, query)
  }

  async getReceived(
    landlordId: string,
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    return this.list({ landlordId }, query)
  }

  async respond(
    id: string,
    landlordId: string,
    dto: RespondRentalApplicationDto
  ): Promise<RentalApplication> {
    const application = await this.findOrThrow(id)
    if (application.landlordId !== landlordId)
      throw new ForbiddenException(
        'Application does not belong to current landlord'
      )
    if (application.status !== 'pending')
      throw new ConflictException('Application has already been resolved')
    application.status = dto.status
    application.reasonCode = dto.reasonCode
    application.actorId = landlordId
    application.actorTimestamp = new Date()
    return this.repository.save(application)
  }

  private async list(
    where: { tenantId?: string; landlordId?: string },
    query: RentalApplicationQueryDto
  ): Promise<RentalApplicationListResult> {
    const records = await this.repository.find({
      where,
      order: { updatedAt: 'DESC' },
    })
    const filtered = query.status
      ? records.filter(item => item.status === query.status)
      : records
    const start = (query.page - 1) * query.limit
    return {
      items: filtered.slice(start, start + query.limit),
      total: filtered.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(filtered.length / query.limit),
    }
  }

  private async findOrThrow(id: string): Promise<RentalApplication> {
    if (!ObjectId.isValid(id))
      throw new NotFoundException('Rental application not found')
    const application = await this.repository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!application)
      throw new NotFoundException('Rental application not found')
    return application
  }
}
