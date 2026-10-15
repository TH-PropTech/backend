/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest asymmetric matchers */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { MongoRepository } from 'typeorm'
import { SupportTicketsService } from './support-tickets.service'
import type {
  SupportTicket,
  TicketMessageEntry,
} from '../schemas/support-ticket.schema'
import type { NotificationsService } from '../../notifications/services/notifications.service'
import { SupportTicketQueryDto } from '../dto/support-ticket.dto'

type RepositoryMock<T> = {
  create: jest.Mock<T, [Partial<T>]>
  find: jest.Mock<Promise<T[]>, [unknown?]>
  findOne: jest.Mock<Promise<T | null>, [unknown?]>
  save: jest.Mock<Promise<T>, [T]>
  updateOne: jest.Mock<Promise<{ matchedCount: number }>, [unknown, unknown]>
}

function createRepositoryMock<T>(): RepositoryMock<T> {
  return {
    create: jest.fn(value => value as T),
    find: jest.fn<Promise<T[]>, [unknown?]>(),
    findOne: jest.fn<Promise<T | null>, [unknown?]>(),
    save: jest.fn<Promise<T>, [T]>(value => Promise.resolve(value)),
    updateOne: jest
      .fn<Promise<{ matchedCount: number }>, [unknown, unknown]>()
      .mockResolvedValue({ matchedCount: 1 }),
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

function createMessage(
  overrides: Partial<TicketMessageEntry> = {}
): TicketMessageEntry {
  return {
    _id: new ObjectId(),
    senderId: 'staff-1',
    senderRole: 'staff',
    content: 'Message',
    attachmentUrls: [],
    isInternal: false,
    createdAt: new Date(),
    ...overrides,
  }
}

type UpdateCall = {
  filter: Record<string, unknown>
  update: {
    $set?: Record<string, unknown>
    $push?: Record<string, unknown>
  }
}

describe('SupportTicketsService', () => {
  let ticketRepository: RepositoryMock<SupportTicket>
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue(undefined),
  }
  let service: SupportTicketsService

  function lastUpdate(): UpdateCall {
    const [filter, update] = ticketRepository.updateOne.mock.calls.at(-1) as [
      Record<string, unknown>,
      UpdateCall['update'],
    ]
    return { filter, update }
  }

  beforeEach(() => {
    ticketRepository = createRepositoryMock<SupportTicket>()
    service = new SupportTicketsService(
      ticketRepository as unknown as MongoRepository<SupportTicket>,
      notificationsService as unknown as NotificationsService
    )
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('creates an urgent ticket with a four-hour SLA and embeds the initial message', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-04T00:00:00.000Z'))

    const ticket = await service.createTicket('tenant-1', 'tenant', {
      category: 'technical',
      subject: 'Cannot access profile',
      description: 'The profile page fails every time I open it.',
      priority: 'urgent',
    })

    expect(ticket.slaDeadline).toEqual(new Date('2026-08-04T04:00:00.000Z'))
    expect(ticketRepository.save).toHaveBeenCalledTimes(1)
    expect(ticketRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            senderId: 'tenant-1',
            content: 'The profile page fails every time I open it.',
            attachmentUrls: [],
            isInternal: false,
          }),
        ],
      })
    )
    expect(notificationsService.createNotification).toHaveBeenCalled()
  })

  it('createTicket returns the ticket without a messages property', async () => {
    const ticket = await service.createTicket('tenant-1', 'tenant', {
      category: 'technical',
      subject: 's',
      description: 'd',
    })
    expect(ticket).not.toHaveProperty('messages')
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
    expect(ticketRepository.updateOne).not.toHaveBeenCalled()
  })

  it('filters internal notes from requester ticket detail', async () => {
    const ticket = createTicket({
      messages: [
        createMessage({ isInternal: true }),
        createMessage({ _id: new ObjectId(), isInternal: false }),
      ],
    })
    ticketRepository.findOne.mockResolvedValue(ticket)

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
    const ticket = createTicket({ messages: [createMessage()] })
    ticketRepository.findOne.mockResolvedValue(ticket)

    await expect(
      service.getTicketDetail(ticket._id.toString(), 'tenant-2', 'tenant')
    ).rejects.toThrow(ForbiddenException)
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
    const { update } = lastUpdate()
    expect(update.$push).toEqual({
      transferHistory: expect.objectContaining({ toStaffId: 'staff-2' }),
    })
    expect(update.$set).toEqual(
      expect.objectContaining({ status: 'escalated', assignedTo: 'staff-2' })
    )
    expect(update.$set).not.toHaveProperty('messages')
    expect(update.$set).not.toHaveProperty('transferHistory')
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
    expect(ticketRepository.updateOne).not.toHaveBeenCalled()
  })

  describe('embedded messages (G-TKT)', () => {
    it('addMessage by staff pushes atomically, returns the old message shape, sets firstResponseAt and waiting_customer, notifies requester', async () => {
      const ticket = createTicket({ assignedTo: 'staff-1' })
      ticketRepository.findOne.mockResolvedValue(ticket)

      const result = await service.addMessage(
        ticket._id.toString(),
        'staff-1',
        'staff',
        { content: 'Hello', attachmentUrls: ['u1'] }
      )

      expect(result).toEqual(
        expect.objectContaining({
          ticketId: ticket._id.toString(),
          senderId: 'staff-1',
          senderRole: 'staff',
          content: 'Hello',
          attachmentUrls: ['u1'],
          isInternal: false,
        })
      )
      expect(result._id).toBeInstanceOf(ObjectId)
      expect(result.createdAt).toBeInstanceOf(Date)
      const { filter, update } = lastUpdate()
      expect(filter).toEqual({
        _id: ticket._id,
        'messages.499': { $exists: false },
      })
      expect(update.$push).toEqual({
        messages: expect.objectContaining({
          _id: result._id,
          content: 'Hello',
        }),
      })
      expect(update.$push?.messages).not.toHaveProperty('ticketId')
      expect(update.$set).toEqual(
        expect.objectContaining({
          status: 'waiting_customer',
          firstResponseAt: expect.any(Date),
        })
      )
      expect(ticketRepository.save).not.toHaveBeenCalled()
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'tenant-1',
        expect.any(String),
        expect.any(String),
        'SUPPORT_REPLY',
        { ticketId: ticket._id.toString() }
      )
    })

    it('addMessage by staff keeps an existing firstResponseAt', async () => {
      const ticket = createTicket({ firstResponseAt: new Date(1) })
      ticketRepository.findOne.mockResolvedValue(ticket)

      await service.addMessage(ticket._id.toString(), 'staff-1', 'staff', {
        content: 'again',
      })

      expect(lastUpdate().update.$set).not.toHaveProperty('firstResponseAt')
    })

    it('addMessage by requester moves status to waiting_staff and keeps firstResponseAt empty', async () => {
      const ticket = createTicket({ assignedTo: 'staff-1' })
      ticketRepository.findOne.mockResolvedValue(ticket)

      const result = await service.addMessage(
        ticket._id.toString(),
        'tenant-1',
        'tenant',
        { content: 'Any update?' }
      )

      expect(result.attachmentUrls).toEqual([])
      expect(result.isInternal).toBe(false)
      const { update } = lastUpdate()
      expect(update.$set).toEqual(
        expect.objectContaining({ status: 'waiting_staff' })
      )
      expect(update.$set).not.toHaveProperty('firstResponseAt')
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        'staff-1',
        expect.any(String),
        expect.any(String),
        'SUPPORT_REPLY',
        expect.anything()
      )
    })

    it('internal staff note keeps status, sets no firstResponseAt and sends no notification', async () => {
      const ticket = createTicket()
      ticketRepository.findOne.mockResolvedValue(ticket)

      const result = await service.addMessage(
        ticket._id.toString(),
        'staff-1',
        'staff',
        { content: 'note', isInternal: true }
      )

      expect(result.isInternal).toBe(true)
      const { update } = lastUpdate()
      expect(update.$set).not.toHaveProperty('status')
      expect(update.$set).not.toHaveProperty('firstResponseAt')
      expect(notificationsService.createNotification).not.toHaveBeenCalled()
    })

    it('answers 409 and notifies nobody when the 500-message cap is reached', async () => {
      const ticket = createTicket()
      ticketRepository.findOne.mockResolvedValue(ticket)
      ticketRepository.updateOne.mockResolvedValue({ matchedCount: 0 })

      await expect(
        service.addMessage(ticket._id.toString(), 'tenant-1', 'tenant', {
          content: 'one too many',
        })
      ).rejects.toThrow(ConflictException)
      expect(notificationsService.createNotification).not.toHaveBeenCalled()
    })

    it('loads the ticket without messages when writing', async () => {
      const ticket = createTicket()
      ticketRepository.findOne.mockResolvedValue(ticket)

      await service.addMessage(ticket._id.toString(), 'tenant-1', 'tenant', {
        content: 'x',
      })

      const options = ticketRepository.findOne.mock.calls[0]?.[0] as {
        select: string[]
      }
      expect(options.select).not.toContain('messages')
      expect(options.select).toContain('requesterId')
    })

    it('staff detail keeps internal notes, orders by createdAt ascending and adds ticketId, without messages on the ticket', async () => {
      const id = new ObjectId()
      const ticket = createTicket({
        _id: id,
        messages: [
          createMessage({
            content: 'late',
            createdAt: new Date('2026-08-04T10:00:00.000Z'),
          }),
          createMessage({
            content: 'early',
            isInternal: true,
            createdAt: new Date('2026-08-04T09:00:00.000Z'),
          }),
        ],
      })
      ticketRepository.findOne.mockResolvedValue(ticket)

      const result = await service.getTicketDetail(
        id.toString(),
        'staff-1',
        'staff'
      )

      expect(result.messages.map(m => m.content)).toEqual(['early', 'late'])
      expect(result.messages[0]).toEqual(
        expect.objectContaining({ ticketId: id.toString(), isInternal: true })
      )
      expect(result.ticket).not.toHaveProperty('messages')
      const options = ticketRepository.findOne.mock.calls[0]?.[0] as {
        select?: unknown
      }
      expect(options.select).toBeUndefined()
    })

    it('detail of a legacy ticket without messages returns an empty thread', async () => {
      const ticket = createTicket()
      ticketRepository.findOne.mockResolvedValue(ticket)

      const result = await service.getTicketDetail(
        ticket._id.toString(),
        'tenant-1',
        'tenant'
      )

      expect(result.messages).toEqual([])
    })

    it('list endpoints project messages out and never return them', async () => {
      ticketRepository.find.mockResolvedValue([
        createTicket({ messages: [createMessage({ isInternal: true })] }),
      ])
      const query = new SupportTicketQueryDto()

      const mine = await service.getMyTickets('tenant-1', query)
      const queue = await service.getTicketQueue(query)

      for (const call of ticketRepository.find.mock.calls) {
        const options = call[0] as { select: string[] }
        expect(options.select).not.toContain('messages')
        expect(options.select).toContain('_id')
      }
      expect(mine.items[0]).not.toHaveProperty('messages')
      expect(queue.items[0]).not.toHaveProperty('messages')
      expect(mine.total).toBe(1)
    })

    it('assign, resolve and close write single fields with updateOne and never touch messages', async () => {
      const ticket = createTicket()
      ticketRepository.findOne.mockResolvedValue(ticket)
      const id = ticket._id.toString()

      const assigned = await service.assignTicket(id, 'staff-9', {
        staffId: 'staff-2',
      })
      expect(assigned).toEqual(
        expect.objectContaining({
          assignedTo: 'staff-2',
          status: 'in_progress',
        })
      )
      expect(lastUpdate().update.$set).toEqual(
        expect.objectContaining({
          assignedTo: 'staff-2',
          status: 'in_progress',
          updatedAt: expect.any(Date),
        })
      )

      await service.resolveTicket(id, 'staff-2', {
        resolutionNote: 'Fixed it',
      })
      expect(lastUpdate().update.$set).toEqual(
        expect.objectContaining({
          status: 'resolved',
          resolutionNote: 'Fixed it',
        })
      )

      await service.closeTicket(id, 'tenant-1', 'tenant')
      expect(lastUpdate().update.$set).toEqual(
        expect.objectContaining({
          status: 'closed',
          closedAt: expect.any(Date),
        })
      )

      for (const [, update] of ticketRepository.updateOne.mock.calls) {
        expect((update as UpdateCall['update']).$set ?? {}).not.toHaveProperty(
          'messages'
        )
      }
      expect(ticketRepository.save).not.toHaveBeenCalled()
    })
  })
})
