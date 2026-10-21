import { ObjectId } from 'mongodb'
import { Test } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { PersonalDataService } from './personal-data.service'
import { AiChatsService } from './ai-chats.service'
import { GroqAgentService } from './groq-agent.service'
import { ApartmentsService } from '../../properties/services/apartments.service'
import { BookingsService } from '../../bookings/services/bookings.service'
import { User } from '../../users/schemas/user.schema'
import { RedisService } from '../../health/services/redis.service'
import { LEGAL_KNOWLEDGE_SEARCH } from '../../legal/utils/legal-knowledge.types'

const ME = new ObjectId().toHexString()
const OTHER = new ObjectId().toHexString()
const day = 24 * 60 * 60 * 1000

function build(data: {
  bookings?: unknown[]
  contracts?: unknown[]
  payments?: unknown[]
  user?: unknown
}): { service: PersonalDataService; find: Record<string, jest.Mock> } {
  const filterBy = (
    rows: unknown[] | undefined,
    key: string,
    id: string
  ): unknown[] =>
    (rows ?? []).filter(row => (row as Record<string, string>)[key] === id)
  const bookingFind = jest.fn(({ where }: { where: Record<string, string> }) =>
    Promise.resolve(
      filterBy(data.bookings, Object.keys(where)[0]!, Object.values(where)[0]!)
    )
  )
  const contractFind = jest.fn(({ where }: { where: Record<string, string> }) =>
    Promise.resolve(
      filterBy(data.contracts, Object.keys(where)[0]!, Object.values(where)[0]!)
    )
  )
  const paymentFind = jest.fn(
    ({ where }: { where: { contractId: { $in: string[] } } }) =>
      Promise.resolve(
        (data.payments ?? []).filter(row =>
          where.contractId.$in.includes(
            (row as { contractId: string }).contractId
          )
        )
      )
  )
  const service = new PersonalDataService(
    { find: bookingFind } as never,
    { find: contractFind } as never,
    { find: paymentFind } as never,
    {
      findOne: jest.fn().mockResolvedValue(data.user ?? null),
    } as never
  )
  return {
    service,
    find: { bookingFind, contractFind, paymentFind },
  }
}

const booking = (over: Record<string, unknown>): Record<string, unknown> => ({
  _id: new ObjectId(),
  apartmentTitle: 'Vinhomes 2PN',
  tenantId: ME,
  landlordId: OTHER,
  visitAt: new Date(Date.now() + 2 * day),
  method: 'onsite',
  status: 'confirmed',
  ...over,
})
const contract = (over: Record<string, unknown>): Record<string, unknown> => ({
  _id: new ObjectId(),
  contractCode: 'HD-001',
  propertyTitle: 'Masteri An Phú',
  tenantId: ME,
  landlordId: OTHER,
  status: 'active',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  monthlyRent: 12_000_000,
  deposit: 24_000_000,
  signedByTenant: true,
  signedByLandlord: true,
  contractHash: 'abcdef0123456789',
  ledgerStatus: 'confirmed',
  ...over,
})

describe('PersonalDataService', () => {
  it("lists upcoming viewings first and only the caller's own", async () => {
    const { service } = build({
      bookings: [
        booking({ apartmentTitle: 'Căn sắp xem' }),
        booking({
          apartmentTitle: 'Căn đã qua',
          visitAt: new Date(Date.now() - 3 * day),
          status: 'completed',
        }),
        booking({
          apartmentTitle: 'Của người khác',
          tenantId: OTHER,
          landlordId: OTHER,
        }),
      ],
    })
    const text = await service.run('get_my_bookings', ME)
    expect(text).toContain('Lịch xem sắp tới:')
    expect(text).toContain('Căn sắp xem')
    expect(text).toContain('đã xác nhận')
    expect(text).toContain('Căn đã qua')
    expect(text).not.toContain('Của người khác')
  })

  it('says so when there is nothing', async () => {
    const { service } = build({})
    expect(await service.run('get_my_bookings', ME)).toBe(
      'Bạn chưa có lịch xem nhà nào.'
    )
    expect(await service.run('get_my_contracts', ME)).toBe(
      'Bạn chưa có hợp đồng thuê nào.'
    )
  })

  it('summarises a contract without identity-document data', async () => {
    const { service } = build({
      contracts: [
        contract({ tenantCccd: '079123456789', landlordCccd: '001234567890' }),
      ],
    })
    const text = await service.run('get_my_contracts', ME)
    expect(text).toContain('HD-001')
    expect(text).toContain('đang hiệu lực')
    expect(text).toContain('bạn là bên thuê')
    expect(text).toContain('abcdef012345…')
    expect(text).not.toContain('079123456789')
    expect(text).not.toContain('001234567890')
  })

  it('shows only invoices the caller must pay, overdue first', async () => {
    const c = contract({})
    const id = (c['_id'] as ObjectId).toHexString()
    const { service } = build({
      contracts: [c],
      payments: [
        {
          contractId: id,
          tenantId: ME,
          payerId: ME,
          type: 'rent',
          amount: 12_000_000,
          dueDate: new Date('2026-11-01'),
          status: 'unpaid',
        },
        {
          contractId: id,
          tenantId: ME,
          payerId: ME,
          type: 'rent',
          amount: 12_000_000,
          dueDate: new Date('2026-10-01'),
          status: 'overdue',
        },
        {
          contractId: id,
          tenantId: ME,
          payerId: OTHER,
          type: 'platform-fee',
          amount: 999_000,
          dueDate: new Date('2026-10-05'),
          status: 'unpaid',
        },
      ],
    })
    const text = await service.run('get_my_payments', ME)
    expect(text).toContain('Hóa đơn cần thanh toán (2):')
    expect(text.indexOf('quá hạn')).toBeLessThan(
      text.indexOf('chưa thanh toán')
    )
    expect(text).not.toContain('phí nền tảng')
  })

  it('reports the eKYC state in plain words', async () => {
    const { service } = build({ user: { kycStatus: 'pending' } })
    expect(await service.run('get_my_kyc_status', ME)).toContain(
      'đang chờ nhân viên duyệt'
    )
  })
})

describe('AiChatsService personal tools', () => {
  async function chatWith(
    personalRun: jest.Mock
  ): Promise<{ service: AiChatsService; groq: { chat: jest.Mock } }> {
    const groq = {
      chat: jest
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 't1',
              type: 'function',
              // the model tries to smuggle in somebody else's id
              function: {
                name: 'get_my_contracts',
                arguments: { userId: 'someone-else' },
              },
            },
          ],
        })
        .mockResolvedValueOnce({ content: 'Đây là hợp đồng của bạn.' }),
    }
    const module = await Test.createTestingModule({
      providers: [
        AiChatsService,
        { provide: GroqAgentService, useValue: groq },
        { provide: ApartmentsService, useValue: {} },
        { provide: BookingsService, useValue: {} },
        { provide: getRepositoryToken(User), useValue: {} },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        { provide: LEGAL_KNOWLEDGE_SEARCH, useValue: { search: jest.fn() } },
        { provide: PersonalDataService, useValue: { run: personalRun } },
      ],
    }).compile()
    return { service: module.get(AiChatsService), groq }
  }

  it('looks up the signed-in user, never an id supplied by the model', async () => {
    const run = jest.fn().mockResolvedValue('Hợp đồng của bạn: HD-001')
    const { service, groq } = await chatWith(run)
    await service.handleUserMessage(
      { userId: 'jwt-user' },
      'Hợp đồng của tôi thế nào?'
    )
    expect(run).toHaveBeenCalledWith('get_my_contracts', 'jwt-user')
    const toolMessage = (
      groq.chat.mock.calls[1]?.[0] as Array<{ role: string; content: string }>
    ).find(m => m.role === 'tool')
    expect(toolMessage?.content).toContain('HD-001')
  })

  it('asks a guest to sign in without touching any data', async () => {
    const run = jest.fn()
    const { service, groq } = await chatWith(run)
    await service.handleUserMessage(
      { deviceId: 'device-guest-1' },
      'Hợp đồng của tôi thế nào?'
    )
    expect(run).not.toHaveBeenCalled()
    const toolMessage = (
      groq.chat.mock.calls[1]?.[0] as Array<{ role: string; content: string }>
    ).find(m => m.role === 'tool')
    expect(toolMessage?.content).toContain('chưa đăng nhập')
  })
})
