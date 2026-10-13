import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import { SupportTicketsService } from './support-tickets.service'
import type { SupportTicket } from '../schemas/support-ticket.schema'
import type { TicketMessage } from '../schemas/ticket-message.schema'
import type { NotificationsService } from '../../notifications/services/notifications.service'
import { SupportTicketQueryDto } from '../dto/support-ticket.dto'

type RepositoryMock<T> = {
  create: jest.Mock<T, [Partial<T>]>
  find: jest.Mock<Promise<T[]>, [unknown?]>
  findOne: jest.Mock<Promise<T | null>, [unknown?]>
  save: jest.Mock<Promise<T>, [T]>
}

function createRepositoryMock<T>(): RepositoryMock<T> {
  return {
    create: jest.fn(value => value as T),
    find: jest.fn<Promise<T[]>, [unknown?]>(),
    findOne: jest.fn<Promise<T | null>, [unknown?]>(),
    save: jest.fn<Promise<T>, [T]>(value => Promise.resolve(value)),
  }
}

function createTicket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    _id: new ObjectId(),
    requesterId: 'tenant-1',
    requesterRole: 'tenant',
    category: 'technical',
    subject: 'Application issue',
    description: 'The application cannot load my profile.',
    priority: 'normal',
    status: 'open',
    slaDeadline: new Date('2026-08-05T00:00:00.000Z'),
    transferHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createMessage(overrides: Partial<TicketMessage> = {}): TicketMessage {
  return {
    _id: new ObjectId(),
    ticketId: new ObjectId().toString(),
    senderId: 'staff-1',
    senderRole: 'staff',
    content: 'Message',
    attachmentUrls: [],
    isInternal: false,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('SupportTicketsService', () => {
  let ticketRepository: RepositoryMock<SupportTicket>
  let messageRepository: RepositoryMock<TicketMessage>
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  let service: SupportTicketsService

  beforeEach(() => {
    ticketRepository = createRepositoryMock<SupportTicket>()
    messageRepository = createRepositoryMock<TicketMessage>()
    service = new SupportTicketsService(
      ticketRepository as unknown as Repository<SupportTicket>,
      messageRepository as unknown as Repository<TicketMessage>,
      notificationsService as unknown as NotificationsService
    )
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('creates an urgent ticket with a four-hour SLA and initial message', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    const ticket = await service.createTicket('tenant-1', 'tenant', {
      category: 'technical',
      subject: 'Cannot access profile',
      description: 'The profile page fails every time I open it.',
      priority: 'urgent',
    })

    expect(ticket.slaDeadline).toEqual(new Date('2026-08-04T04:00:00.000Z'))
    expect(messageRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        senderId: 'tenant-1',
        isInternal: false,
      })
    )
    expect(notificationsService.createNotification).toHaveBeenCalled()
  })

  it('rejects a linked entity type without an entity identifier', async () => {
    await expect(
      service.createTicket('tenant-1', 'tenant', {
        category: 'listing',
        subject: 'Listing data issue',
        description: 'The listing data shown to me is not correct.',
        linkedEntityType: 'apartment',
      })
    ).rejects.toThrow(BadRequestException)
    expect(ticketRepository.save).not.toHaveBeenCalled()
  })

  it('rejects internal notes submitted by a non-staff requester', async () => {
    const ticket = createTicket()
    ticketRepository.findOne.mockResolvedValue(ticket)

    await expect(
      service.addMessage(ticket._id.toString(), ticket.requesterId, 'tenant', {
        content: 'Attempted hidden note',
        isInternal: true,
      })
    ).rejects.toThrow(ForbiddenException)
    expect(messageRepository.save).not.toHaveBeenCalled()
  })

  it('filters internal notes from requester ticket detail', async () => {
    const ticket = createTicket()
    ticketRepository.findOne.mockResolvedValue(ticket)
    messageRepository.find.mockResolvedValue([
      createMessage({ ticketId: ticket._id.toString(), isInternal: true }),
      createMessage({
        _id: new ObjectId(),
        ticketId: ticket._id.toString(),
        isInternal: false,
      }),
    ])

    const result = await service.getTicketDetail(
      ticket._id.toString(),
      ticket.requesterId,
      'tenant'
    )

    expect(result.messages).toHaveLength(1)
    expect(result.messages).toEqual([
      expect.objectContaining({ isInternal: false }),
    ])
  })

  it('rejects ticket detail access from an unrelated requester', async () => {
    const ticket = createTicket()
    ticketRepository.findOne.mockResolvedValue(ticket)

    await expect(
      service.getTicketDetail(ticket._id.toString(), 'tenant-2', 'tenant')
    ).rejects.toThrow(ForbiddenException)
    expect(messageRepository.find).not.toHaveBeenCalled()
  })

  it('records immutable transfer history when staff escalates a ticket', async () => {
    const previousTransfer = {
      fromStaffId: 'staff-0',
      toStaffId: 'staff-1',
      transferredAt: new Date('2026-08-01T00:00:00.000Z'),
      reason: 'Initial assignment',
    }
    const ticket = createTicket({
      assignedTo: 'staff-1',
      transferHistory: [previousTransfer],
    })
    ticketRepository.findOne.mockResolvedValue(ticket)

    const result = await service.escalateTicket(
      ticket._id.toString(),
      'staff-1',
      { toStaffId: 'staff-2', reason: 'Requires payment expertise' }
    )

    expect(result.assignedTo).toBe('staff-2')
    expect(result.transferHistory).toHaveLength(2)
    expect(result.transferHistory[0]).toBe(previousTransfer)
    expect(result.transferHistory[1]).toEqual(
      expect.objectContaining({
        fromStaffId: 'staff-1',
        toStaffId: 'staff-2',
        reason: 'Requires payment expertise',
      })
    )
  })

  it('returns only currently breached unresolved tickets when requested', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-04T12:00:00.000Z'))
    ticketRepository.find.mockResolvedValue([
      createTicket({ slaDeadline: new Date('2026-08-04T10:00:00.000Z') }),
      createTicket({
        _id: new ObjectId(),
        slaDeadline: new Date('2026-08-04T14:00:00.000Z'),
      }),
      createTicket({
        _id: new ObjectId(),
        status: 'resolved',
        slaDeadline: new Date('2026-08-04T08:00:00.000Z'),
      }),
    ])
    const query = new SupportTicketQueryDto()
    query.slaBreached = 'true'

    const result = await service.getTicketQueue(query)

    expect(result.items).toHaveLength(1)
    expect(result.items).toEqual([expect.objectContaining({ status: 'open' })])
  })

  it('rejects replies to a closed ticket', async () => {
    const ticket = createTicket({ status: 'closed' })
    ticketRepository.findOne.mockResolvedValue(ticket)

    await expect(
      service.addMessage(ticket._id.toString(), ticket.requesterId, 'tenant', {
        content: 'Can I add another reply?',
      })
    ).rejects.toThrow(BadRequestException)
  })
})
