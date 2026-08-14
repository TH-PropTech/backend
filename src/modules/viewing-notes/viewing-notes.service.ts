import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { ObjectId } from 'mongodb'
import { Repository } from 'typeorm'
import { ApartmentsService } from '../apartments/apartments.service'
import { BookingsService } from '../bookings/bookings.service'
import { CreateViewingNoteDto } from './dto/create-viewing-note.dto'
import { UpdateViewingNoteDto } from './dto/update-viewing-note.dto'
import { ViewingNoteQueryDto } from './dto/viewing-note-query.dto'
import { ViewingNote } from './schemas/viewing-note.schema'

export interface ViewingNoteListResult {
  items: ViewingNote[]
  total: number
  page: number
  limit: number
  totalPages: number
}

@Injectable()
export class ViewingNotesService {
  constructor(
    @InjectRepository(ViewingNote)
    private readonly viewingNoteRepository: Repository<ViewingNote>,
    private readonly apartmentsService: ApartmentsService,
    private readonly bookingsService: BookingsService
  ) {}

  /** Create a private viewing note. [uc_customer_booking] [uc_book_viewing] */
  async create(
    userId: string,
    dto: CreateViewingNoteDto
  ): Promise<ViewingNote> {
    await this.apartmentsService.findOne(dto.apartmentId)

    if (dto.bookingId) {
      const booking = await this.bookingsService.findOneById(dto.bookingId)
      if (booking.tenantId !== userId) {
        throw new ForbiddenException('Booking does not belong to current user')
      }
      if (booking.apartmentId !== dto.apartmentId) {
        throw new BadRequestException(
          'Booking does not belong to the selected apartment'
        )
      }
    }

    const note = this.viewingNoteRepository.create({
      userId,
      apartmentId: dto.apartmentId,
      bookingId: dto.bookingId ?? null,
      noise: dto.noise ?? null,
      lighting: dto.lighting ?? null,
      smell: dto.smell ?? null,
      signal: dto.signal ?? null,
      waterPressure: dto.waterPressure ?? null,
      parking: dto.parking ?? null,
      neighbors: dto.neighbors ?? null,
      extraFees: dto.extraFees ?? [],
      questions: dto.questions ?? [],
      photos: dto.photos ?? [],
      isPrivate: true,
    })

    return this.viewingNoteRepository.save(note)
  }

  async getMyNotes(
    userId: string,
    query: ViewingNoteQueryDto
  ): Promise<ViewingNoteListResult> {
    const notes = await this.viewingNoteRepository.find({
      where: {
        userId,
        ...(query.apartmentId ? { apartmentId: query.apartmentId } : {}),
      },
      order: { updatedAt: 'DESC' },
    })
    const start = (query.page - 1) * query.limit

    return {
      items: notes.slice(start, start + query.limit),
      total: notes.length,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(notes.length / query.limit),
    }
  }

  async getById(id: string, userId: string): Promise<ViewingNote> {
    return this.findOwnedOrThrow(id, userId)
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateViewingNoteDto
  ): Promise<ViewingNote> {
    const note = await this.findOwnedOrThrow(id, userId)
    Object.assign(note, dto)
    note.isPrivate = true
    return this.viewingNoteRepository.save(note)
  }

  async delete(id: string, userId: string): Promise<void> {
    const note = await this.findOwnedOrThrow(id, userId)
    await this.viewingNoteRepository.remove(note)
  }

  private async findOwnedOrThrow(
    id: string,
    userId: string
  ): Promise<ViewingNote> {
    if (!ObjectId.isValid(id)) {
      throw new NotFoundException('Viewing note not found')
    }

    const note = await this.viewingNoteRepository.findOne({
      where: { _id: new ObjectId(id) },
    })
    if (!note) {
      throw new NotFoundException('Viewing note not found')
    }
    if (note.userId !== userId) {
      throw new ForbiddenException(
        'Viewing note does not belong to current user'
      )
    }

    return note
  }
}
