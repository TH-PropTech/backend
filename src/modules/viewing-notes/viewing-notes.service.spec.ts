import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { ApartmentsService } from '../apartments/apartments.service'
import type { Apartment } from '../apartments/schemas/apartment.schema'
import type { BookingsService } from '../bookings/bookings.service'
import type { Booking } from '../bookings/schemas/booking.schema'
import type { ViewingNote } from './schemas/viewing-note.schema'
import { ViewingNotesService } from './viewing-notes.service'

type NoteRepositoryMock = {
  create: jest.Mock<ViewingNote, [Partial<ViewingNote>]>
  find: jest.Mock<Promise<ViewingNote[]>, [unknown?]>
  findOne: jest.Mock<Promise<ViewingNote | null>, [unknown?]>
  remove: jest.Mock<Promise<ViewingNote>, [ViewingNote]>
  save: jest.Mock<Promise<ViewingNote>, [ViewingNote]>
}

function createNote(overrides: Partial<ViewingNote> = {}): ViewingNote {
  return {
    _id: new ObjectId(),
    userId: 'tenant-1',
    apartmentId: 'apartment-1',
    bookingId: null,
    noise: 3,
    lighting: 4,
    smell: 'Không có mùi bất thường',
    signal: 4,
    waterPressure: 3,
    parking: 4,
    neighbors: 4,
    extraFees: [],
    questions: [],
    photos: [],
    isPrivate: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('ViewingNotesService', () => {
  let noteRepository: NoteRepositoryMock
  let apartmentsService: jest.Mocked<Pick<ApartmentsService, 'findOne'>>
  let bookingsService: jest.Mocked<Pick<BookingsService, 'findOneById'>>
  let service: ViewingNotesService

  beforeEach(() => {
    noteRepository = {
      create: jest.fn(value => value as ViewingNote),
      find: jest.fn<Promise<ViewingNote[]>, [unknown?]>(),
      findOne: jest.fn<Promise<ViewingNote | null>, [unknown?]>(),
      remove: jest.fn<Promise<ViewingNote>, [ViewingNote]>(value =>
        Promise.resolve(value)
      ),
      save: jest.fn<Promise<ViewingNote>, [ViewingNote]>(value =>
        Promise.resolve(value)
      ),
    }
    apartmentsService = {
      findOne: jest.fn(),
    }
    bookingsService = {
      findOneById: jest.fn(),
    }
    service = new ViewingNotesService(
      noteRepository as unknown as Repository<ViewingNote>,
      apartmentsService as unknown as ApartmentsService,
      bookingsService as unknown as BookingsService
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('creates an always-private note for an existing apartment', async () => {
    apartmentsService.findOne.mockResolvedValue({} as Apartment)

    const result = await service.create('tenant-1', {
      apartmentId: 'apartment-1',
      noise: 3,
      lighting: 4,
      questions: ['Phí quản lý bao nhiêu?'],
    })

    expect(apartmentsService.findOne).toHaveBeenCalledWith('apartment-1')
    expect(result).toEqual(
      expect.objectContaining({
        userId: 'tenant-1',
        apartmentId: 'apartment-1',
        isPrivate: true,
      })
    )
  })

  it('accepts an owned booking linked to the same apartment', async () => {
    apartmentsService.findOne.mockResolvedValue({} as Apartment)
    bookingsService.findOneById.mockResolvedValue({
      tenantId: 'tenant-1',
      apartmentId: 'apartment-1',
    } as Booking)

    const result = await service.create('tenant-1', {
      apartmentId: 'apartment-1',
      bookingId: 'booking-1',
    })

    expect(result.bookingId).toBe('booking-1')
  })

  it('rejects a booking owned by another tenant', async () => {
    apartmentsService.findOne.mockResolvedValue({} as Apartment)
    bookingsService.findOneById.mockResolvedValue({
      tenantId: 'tenant-2',
      apartmentId: 'apartment-1',
    } as Booking)

    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        bookingId: 'booking-1',
      })
    ).rejects.toThrow(ForbiddenException)
    expect(noteRepository.save).not.toHaveBeenCalled()
  })

  it('rejects a booking linked to another apartment', async () => {
    apartmentsService.findOne.mockResolvedValue({} as Apartment)
    bookingsService.findOneById.mockResolvedValue({
      tenantId: 'tenant-1',
      apartmentId: 'apartment-2',
    } as Booking)

    await expect(
      service.create('tenant-1', {
        apartmentId: 'apartment-1',
        bookingId: 'booking-1',
      })
    ).rejects.toThrow(BadRequestException)
    expect(noteRepository.save).not.toHaveBeenCalled()
  })

  it('lists only the current user notes with optional apartment filter', async () => {
    noteRepository.find.mockResolvedValue([
      createNote(),
      createNote({ _id: new ObjectId() }),
    ])

    const result = await service.getMyNotes('tenant-1', {
      apartmentId: 'apartment-1',
      page: 1,
      limit: 20,
    })

    expect(noteRepository.find).toHaveBeenCalledWith({
      where: { userId: 'tenant-1', apartmentId: 'apartment-1' },
      order: { updatedAt: 'DESC' },
    })
    expect(result.items).toHaveLength(2)
  })

  it('returns an owned note by id', async () => {
    const note = createNote()
    noteRepository.findOne.mockResolvedValue(note)

    const result = await service.getById(note._id.toString(), 'tenant-1')

    expect(result).toBe(note)
  })

  it('rejects read access by another user', async () => {
    const note = createNote({ userId: 'tenant-2' })
    noteRepository.findOne.mockResolvedValue(note)

    await expect(
      service.getById(note._id.toString(), 'tenant-1')
    ).rejects.toThrow(ForbiddenException)
  })

  it('updates observations without changing ownership, apartment or privacy', async () => {
    const note = createNote()
    noteRepository.findOne.mockResolvedValue(note)

    const result = await service.update(note._id.toString(), 'tenant-1', {
      noise: 5,
      questions: ['Có được nuôi thú cưng không?'],
    })

    expect(result.noise).toBe(5)
    expect(result.userId).toBe('tenant-1')
    expect(result.apartmentId).toBe('apartment-1')
    expect(result.isPrivate).toBe(true)
  })

  it('deletes only an owned note', async () => {
    const note = createNote()
    noteRepository.findOne.mockResolvedValue(note)

    await service.delete(note._id.toString(), 'tenant-1')

    expect(noteRepository.remove).toHaveBeenCalledWith(note)
  })

  it('returns not found for an invalid note id without calling the repository', async () => {
    await expect(service.getById('invalid-id', 'tenant-1')).rejects.toThrow(
      NotFoundException
    )
    expect(noteRepository.findOne).not.toHaveBeenCalled()
  })
})
