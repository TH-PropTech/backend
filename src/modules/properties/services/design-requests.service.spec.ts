import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { UserStatus } from '../../users/schemas/user.schema'
import {
  DesignRequestsService,
  type DesignRequestActor,
} from './design-requests.service'

const APARTMENT_ID = new ObjectId().toHexString()
const OTHER_APARTMENT_ID = new ObjectId().toHexString()
const LANDLORD_ID = new ObjectId().toHexString()
const STRANGER_ID = new ObjectId().toHexString()
const STAFF_ID = new ObjectId().toHexString()
const ADMIN_ID = new ObjectId().toHexString()
const STAFF_2 = new ObjectId().toHexString()
const ADMIN_2 = new ObjectId().toHexString()

const landlord: DesignRequestActor = { id: LANDLORD_ID, role: 'landlord' }
const stranger: DesignRequestActor = { id: STRANGER_ID, role: 'landlord' }
const staff: DesignRequestActor = { id: STAFF_ID, role: 'staff' }
const admin: DesignRequestActor = { id: ADMIN_ID, role: 'admin' }
const staff_2: DesignRequestActor = { id: STAFF_2, role: 'staff' }

interface FakeDesign {
  id: string
  name: string
  visible: boolean
}

type Doc = Record<string, unknown>

function getPath(doc: Doc, key: string): unknown {
  return doc[key]
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = getPath(doc, key)
    if (cond instanceof ObjectId) return String(value) === cond.toString()
    if (cond && typeof cond === 'object' && '$in' in (cond as Doc)) {
      return (cond as { $in: unknown[] }).$in.includes(value)
    }
    return value === cond
  })
}

function setup(
  opts: {
    designs?: FakeDesign[]
    users?: Array<{ id: string; fullName: string; email: string }>
    activeUsers?: Array<{ id: string; role: 'staff' | 'admin' }>
    notifyFails?: boolean
  } = {}
): {
  service: DesignRequestsService
  docs: Doc[]
  designs: FakeDesign[]
  requestRepo: {
    findOne: ReturnType<typeof jest.fn>
    updateOne: ReturnType<typeof jest.fn>
    findAndCount: ReturnType<typeof jest.fn>
    save: ReturnType<typeof jest.fn>
  }
  designsService: {
    listAll: ReturnType<typeof jest.fn>
    setVisible: ReturnType<typeof jest.fn>
  }
  userRepo: {
    find: ReturnType<typeof jest.fn>
    aggregate: ReturnType<typeof jest.fn>
  }
  apartmentRepo: { aggregate: ReturnType<typeof jest.fn> }
  notifications: { createNotificationOnce: ReturnType<typeof jest.fn> }
} {
  const docs: Doc[] = []
  const designs: FakeDesign[] = opts.designs ?? [
    { id: 'd-new', name: 'Mới', visible: false },
    { id: 'd-old', name: 'Cũ', visible: true },
  ]
  const users = opts.users ?? [
    { id: LANDLORD_ID, fullName: 'Chủ Nhà', email: 'cn@x.vn' },
    { id: ADMIN_ID, fullName: 'Admin A', email: 'a@x.vn' },
    { id: STAFF_ID, fullName: 'Nhân Viên A', email: 's@x.vn' },
  ]
  const activeUsers = opts.activeUsers ?? [
    { id: STAFF_ID, role: 'staff' },
    { id: STAFF_2, role: 'staff' },
    { id: ADMIN_ID, role: 'admin' },
    { id: ADMIN_2, role: 'admin' },
  ]

  const requestRepo = {
    create: jest.fn((v: Doc) => ({ ...v })),
    save: jest.fn((v: Doc) => {
      const doc = {
        _id: new ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...v,
      }
      docs.push(doc)
      return Promise.resolve(doc)
    }),
    findOne: jest.fn(({ where }: { where: Doc }) => {
      const found = docs.find(d => {
        const w: Doc = {}
        for (const [k, v] of Object.entries(where)) w[k] = v
        return matches(d, w)
      })
      return Promise.resolve(found ?? null)
    }),
    updateOne: jest.fn((filter: Doc, update: Doc) => {
      const doc = docs.find(d => matches(d, filter))
      if (!doc) return Promise.resolve({ matchedCount: 0 })
      const set = (update.$set ?? {}) as Doc
      Object.assign(doc, set)
      const inc = (update.$inc ?? {}) as Record<string, number>
      for (const [k, v] of Object.entries(inc)) {
        doc[k] = (doc[k] as number) + v
      }
      const push = update.$push as { events: { $each: unknown[] } } | undefined
      if (push) (doc.events as unknown[]).push(...push.events.$each)
      return Promise.resolve({ matchedCount: 1 })
    }),
    findAndCount: jest.fn(() => Promise.resolve([docs, docs.length])),
  }

  const designsService = {
    listAll: jest.fn(() => Promise.resolve(designs.map(d => ({ ...d })))),
    setVisible: jest.fn((_a: string, id: string, visible: boolean) => {
      const d = designs.find(x => x.id === id)
      if (!d) return Promise.reject(new NotFoundException())
      d.visible = visible
      return Promise.resolve()
    }),
  }

  const userRepo = {
    find: jest.fn(({ where }: { where: { role: string } }) =>
      Promise.resolve(
        activeUsers
          .filter(u => u.role === where.role)
          .map(u => ({ _id: new ObjectId(u.id) }))
      )
    ),
    aggregate: jest.fn(
      (pipeline: Array<{ $match?: { _id: { $in: ObjectId[] } } }>) => ({
        toArray: (): Promise<unknown[]> => {
          const ids = (pipeline[0]?.$match?._id.$in ?? []).map(String)
          return Promise.resolve(
            users
              .filter(u => ids.includes(u.id))
              .map(u => ({
                _id: new ObjectId(u.id),
                fullName: u.fullName,
                email: u.email,
              }))
          )
        },
      })
    ),
  }

  const apartments: Record<string, { title: string; landlordId: string }> = {
    [APARTMENT_ID]: { title: 'Căn A1', landlordId: LANDLORD_ID },
    [OTHER_APARTMENT_ID]: { title: 'Căn B2', landlordId: STRANGER_ID },
  }
  const apartmentRepo = {
    aggregate: jest.fn(
      (
        pipeline: Array<{ $match: { _id: ObjectId | { $in: ObjectId[] } } }>
      ) => ({
        toArray: (): Promise<unknown[]> => {
          const m = pipeline[0]?.$match._id
          const ids = m instanceof ObjectId ? [m] : (m?.$in ?? [])
          return Promise.resolve(
            ids
              .filter(id => apartments[id.toString()])
              .map(id => ({ _id: id, ...apartments[id.toString()] }))
          )
        },
      })
    ),
  }

  const notifications = {
    createNotificationOnce: jest.fn(() =>
      opts.notifyFails ? Promise.reject(new Error('boom')) : Promise.resolve({})
    ),
  }

  const service = new DesignRequestsService(
    requestRepo as never,
    apartmentRepo as never,
    userRepo as never,
    designsService as never,
    notifications as never
  )
  return {
    service,
    docs,
    designs,
    requestRepo,
    designsService,
    userRepo,
    apartmentRepo,
    notifications,
  }
}

const createDto = {
  apartmentId: APARTMENT_ID,
  kind: 'create' as const,
  brief: 'Muốn thiết kế phòng khách',
}

function recipientsOf(n: {
  createNotificationOnce: ReturnType<typeof jest.fn>
}): string[] {
  return n.createNotificationOnce.mock.calls.map(c => c[0] as string)
}

describe('DesignRequestsService', () => {
  describe('happy path', () => {
    it('submit -> start -> deliver -> approve (create)', async () => {
      const ctx = setup()
      const { service } = ctx
      const created = await service.create(landlord, createDto)
      expect(created.status).toBe('submitted')
      expect(created.revision).toBe(0)
      expect(created.apartment).toEqual({ id: APARTMENT_ID, title: 'Căn A1' })
      expect(created.landlord).toEqual({
        id: LANDLORD_ID,
        name: 'Chủ Nhà',
        email: 'cn@x.vn',
      })
      const id = created.id

      const started = await service.start(id, staff)
      expect(started.status).toBe('in_progress')
      expect(started.assignedAdminId).toBe(STAFF_ID)
      expect(started.assignee).toEqual({ id: STAFF_ID, name: 'Nhân Viên A' })

      const delivered = await service.deliver(id, staff, {
        designId: 'd-new',
        note: 'Xong',
      })
      expect(delivered.status).toBe('delivered')
      expect(delivered.revision).toBe(1)
      expect(delivered.deliveredDesignId).toBe('d-new')
      expect(delivered.deliveredDesign?.id).toBe('d-new')
      // deliver does not change visibility
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(false)

      const approved = await service.approve(id, landlord)
      expect(approved.status).toBe('approved')
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(true)
      // kind create: nothing else hidden
      expect(ctx.designs.find(d => d.id === 'd-old')?.visible).toBe(true)
      expect(approved.events.map(e => e.type)).toEqual([
        'submitted',
        'started',
        'delivered',
        'approved',
      ])
      expect(approved.events[1]?.actorName).toBe('Nhân Viên A')
      expect(approved.events[1]?.actorRole).toBe('staff')
      expect(approved.events[2]?.revision).toBe(1)
    })

    it('edit: approving hides the replaced old design', async () => {
      const ctx = setup()
      const { service } = ctx
      const { id } = await service.create(landlord, {
        apartmentId: APARTMENT_ID,
        kind: 'edit',
        targetDesignId: 'd-old',
        brief: 'Sửa',
      })
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      await service.approve(id, landlord)
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(true)
      expect(ctx.designs.find(d => d.id === 'd-old')?.visible).toBe(false)
    })

    it('edit delivering the same design keeps it visible', async () => {
      const ctx = setup()
      const { service } = ctx
      const { id } = await service.create(landlord, {
        apartmentId: APARTMENT_ID,
        kind: 'edit',
        targetDesignId: 'd-old',
        brief: 'Sửa',
      })
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-old' })
      await service.approve(id, landlord)
      expect(ctx.designs.find(d => d.id === 'd-old')?.visible).toBe(true)
    })
  })

  it('revision loop counts 1 then 2', async () => {
    const { service } = setup()
    const { id } = await service.create(landlord, createDto)
    await service.start(id, staff)
    const first = await service.deliver(id, staff, { designId: 'd-new' })
    expect(first.revision).toBe(1)
    const fb = await service.feedback(id, landlord, { note: 'Sửa màu' })
    expect(fb.status).toBe('changes_requested')
    expect(fb.events.at(-1)).toMatchObject({ type: 'feedback', revision: 1 })
    await service.start(id, staff)
    const second = await service.deliver(id, staff, { designId: 'd-old' })
    expect(second.revision).toBe(2)
    expect(second.deliveredDesignId).toBe('d-old')
    expect((await service.approve(id, landlord)).status).toBe('approved')
  })

  it('request-info -> reply loop and reject', async () => {
    const { service } = setup()
    const { id } = await service.create(landlord, createDto)
    const needs = await service.requestInfo(id, staff, { note: 'Thêm ảnh' })
    expect(needs.status).toBe('needs_info')
    const replied = await service.reply(id, landlord, {
      note: 'Đây',
      attachmentUrls: ['https://x.vn/a.png'],
    })
    expect(replied.status).toBe('submitted')
    expect(replied.events.at(-1)).toMatchObject({
      type: 'info_provided',
      attachmentUrls: ['https://x.vn/a.png'],
    })
    const rejected = await service.reject(id, staff, { note: 'Không phù hợp' })
    expect(rejected.status).toBe('rejected')
    expect(rejected.events.at(-1)?.note).toBe('Không phù hợp')
  })

  it('reject is allowed from legacy escalated', async () => {
    const { service, docs } = setup()
    const { id } = await service.create(landlord, createDto)
    docs[0]!.status = 'escalated'
    expect((await service.reject(id, admin, { note: 'Từ chối' })).status).toBe(
      'rejected'
    )
  })

  it('start is allowed straight from submitted and from legacy escalated', async () => {
    const { service, docs } = setup()
    const a = await service.create(landlord, createDto)
    expect((await service.start(a.id, staff)).status).toBe('in_progress')
    docs[0]!.status = 'escalated'
    docs[0]!.assignedAdminId = null
    expect((await service.start(a.id, staff)).status).toBe('in_progress')
  })

  describe('cancel', () => {
    const steps: Record<
      string,
      (s: DesignRequestsService, id: string) => Promise<unknown>
    > = {
      submitted: () => Promise.resolve(),
      needs_info: (s, id) => s.requestInfo(id, staff, { note: 'n' }),
      in_progress: async (s, id) => {
        await s.start(id, staff)
      },
      delivered: async (s, id) => {
        await s.start(id, staff)
        await s.deliver(id, staff, { designId: 'd-new' })
      },
      changes_requested: async (s, id) => {
        await s.start(id, staff)
        await s.deliver(id, staff, { designId: 'd-new' })
        await s.feedback(id, landlord, { note: 'n' })
      },
    }
    it.each(Object.keys(steps))('cancels from %s', async status => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      await steps[status]?.(service, id)
      const out = await service.cancel(id, landlord)
      expect(out.status).toBe('cancelled')
      expect(out.events.at(-1)?.type).toBe('cancelled')
    })

    it.each(['rejected', 'approved', 'cancelled'])(
      'rejects cancel from terminal %s with 409',
      async status => {
        const { service, docs } = setup()
        const { id } = await service.create(landlord, createDto)
        docs[0]!.status = status
        await expect(service.cancel(id, landlord)).rejects.toThrow(
          new ConflictException('DESIGN_REQUEST_INVALID_STATE')
        )
      }
    )
  })

  describe('invalid states', () => {
    it('409 DESIGN_REQUEST_INVALID_STATE for wrong-state actions', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      const bad = [
        service.reply(id, landlord, { note: 'n' }),
        service.approve(id, landlord),
        service.feedback(id, landlord, { note: 'n' }),
        service.deliver(id, staff, { designId: 'd-new' }),
      ]
      for (const p of bad) {
        await expect(p).rejects.toMatchObject({
          message: 'DESIGN_REQUEST_INVALID_STATE',
        })
        await expect(p).rejects.toBeInstanceOf(ConflictException)
      }
      await service.start(id, staff)
      await expect(service.start(id, staff_2)).rejects.toBeInstanceOf(
        ConflictException
      )
      await expect(
        service.requestInfo(id, staff, { note: 'n' })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('409 when the conditional update matches 0 documents (concurrent call)', async () => {
      const { service, requestRepo } = setup()
      const { id } = await service.create(landlord, createDto)
      requestRepo.updateOne.mockResolvedValueOnce({ matchedCount: 0 })
      await expect(service.start(id, staff)).rejects.toThrow(
        new ConflictException('DESIGN_REQUEST_INVALID_STATE')
      )
    })

    it('guards the update with status $in and the revision on deliver', async () => {
      const { service, requestRepo } = setup()
      const { id } = await service.create(landlord, createDto)
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      const [filter, update] = requestRepo.updateOne.mock.calls.at(-1) as [
        Record<string, unknown>,
        Record<string, unknown>,
      ]
      expect(filter).toMatchObject({
        status: { $in: ['in_progress'] },
        revision: 0,
      })
      expect(update.$inc).toEqual({ revision: 1 })
      expect(
        (update.$push as { events: { $slice: number } }).events.$slice
      ).toBe(-500)
    })

    it('unknown / malformed id is 404', async () => {
      const { service } = setup()
      await expect(service.cancel('nope', landlord)).rejects.toBeInstanceOf(
        NotFoundException
      )
      await expect(
        service.getById(new ObjectId().toHexString(), admin)
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('create validation', () => {
    it('one active request per apartment, new one allowed after terminal', async () => {
      const { service } = setup()
      const first = await service.create(landlord, createDto)
      await expect(service.create(landlord, createDto)).rejects.toThrow(
        new ConflictException('DESIGN_REQUEST_ACTIVE_EXISTS')
      )
      await service.cancel(first.id, landlord)
      await expect(service.create(landlord, createDto)).resolves.toBeDefined()
    })

    it('404 APARTMENT_NOT_FOUND and 403 APARTMENT_ACCESS_DENIED', async () => {
      const { service } = setup()
      await expect(
        service.create(landlord, {
          ...createDto,
          apartmentId: new ObjectId().toHexString(),
        })
      ).rejects.toThrow(new NotFoundException('APARTMENT_NOT_FOUND'))
      await expect(
        service.create(landlord, { ...createDto, apartmentId: 'bad' })
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.create(stranger, createDto)).rejects.toThrow(
        new ForbiddenException('APARTMENT_ACCESS_DENIED')
      )
    })

    it('edit requires an existing target design', async () => {
      const { service } = setup()
      await expect(
        service.create(landlord, { ...createDto, kind: 'edit' })
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        service.create(landlord, {
          ...createDto,
          kind: 'edit',
          targetDesignId: 'ghost',
        })
      ).rejects.toThrow(new BadRequestException('DESIGN_NOT_FOUND'))
    })

    it('stores no target for create kind', async () => {
      const { service } = setup()
      const out = await service.create(landlord, {
        ...createDto,
        targetDesignId: 'd-old',
      })
      expect(out.targetDesignId).toBeNull()
    })
  })

  describe('authorization', () => {
    it('403 DESIGN_REQUEST_ACCESS_DENIED for non-owner landlord actions and reads', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      const denied = new ForbiddenException('DESIGN_REQUEST_ACCESS_DENIED')
      await expect(service.cancel(id, stranger)).rejects.toThrow(denied)
      await expect(service.reply(id, stranger, { note: 'n' })).rejects.toThrow(
        denied
      )
      await expect(service.approve(id, stranger)).rejects.toThrow(denied)
      await expect(
        service.feedback(id, stranger, { note: 'n' })
      ).rejects.toThrow(denied)
      await expect(service.getById(id, stranger)).rejects.toThrow(denied)
    })

    it('staff and admin may read any request', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      await expect(service.getById(id, staff)).resolves.toMatchObject({ id })
      await expect(service.getById(id, admin)).resolves.toMatchObject({ id })
    })

    it('a landlord actor cannot start or deliver (service guard)', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      await expect(service.start(id, landlord)).rejects.toThrow(
        new ForbiddenException('DESIGN_REQUEST_STAFF_ONLY')
      )
      await expect(
        service.deliver(id, landlord, { designId: 'd-new' })
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('only the assignee may deliver; an admin can override', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      await service.start(id, staff)
      await expect(
        service.deliver(id, staff_2, { designId: 'd-new' })
      ).rejects.toThrow(new ForbiddenException('DESIGN_REQUEST_NOT_ASSIGNEE'))
      await expect(
        service.deliver(id, admin, { designId: 'd-new' })
      ).resolves.toMatchObject({ status: 'delivered' })
    })

    it('two staff claiming the same request: the second gets 409', async () => {
      const { service } = setup()
      const { id } = await service.create(landlord, createDto)
      await service.start(id, staff)
      await expect(service.start(id, staff_2)).rejects.toThrow(
        new ConflictException('DESIGN_REQUEST_INVALID_STATE')
      )
    })
  })

  it('deliver with an unknown designId is 400 DESIGN_NOT_FOUND', async () => {
    const { service } = setup()
    const { id } = await service.create(landlord, createDto)
    await service.start(id, staff)
    await expect(
      service.deliver(id, staff, { designId: 'ghost' })
    ).rejects.toThrow(new BadRequestException('DESIGN_NOT_FOUND'))
  })

  describe('approve ordering and idempotency', () => {
    async function toDelivered(ctx: ReturnType<typeof setup>): Promise<string> {
      const { id } = await ctx.service.create(landlord, {
        apartmentId: APARTMENT_ID,
        kind: 'edit',
        targetDesignId: 'd-old',
        brief: 'Sửa',
      })
      await ctx.service.start(id, staff)
      await ctx.service.deliver(id, staff, { designId: 'd-new' })
      return id
    }

    it('visibility failure leaves the request delivered and retryable', async () => {
      const ctx = setup()
      const id = await toDelivered(ctx)
      ctx.designsService.setVisible.mockRejectedValueOnce(new Error('db down'))
      await expect(ctx.service.approve(id, landlord)).rejects.toBeInstanceOf(
        InternalServerErrorException
      )
      expect(ctx.docs[0]?.status).toBe('delivered')
      // retry succeeds
      const out = await ctx.service.approve(id, landlord)
      expect(out.status).toBe('approved')
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(true)
      expect(ctx.designs.find(d => d.id === 'd-old')?.visible).toBe(false)
    })

    it('updates design visibility before flipping status', async () => {
      const ctx = setup()
      const id = await toDelivered(ctx)
      const order: string[] = []
      ctx.designsService.setVisible.mockImplementation(
        (_a: string, d: string) => {
          order.push(`vis:${d}`)
          return Promise.resolve()
        }
      )
      ctx.requestRepo.updateOne.mockImplementationOnce(() => {
        order.push('status')
        return Promise.resolve({ matchedCount: 1 })
      })
      await ctx.service.approve(id, landlord)
      expect(order).toEqual(['vis:d-new', 'vis:d-old', 'status'])
    })

    it('restores visibility when the status flip loses a race', async () => {
      const ctx = setup()
      const id = await toDelivered(ctx)
      ctx.requestRepo.updateOne.mockImplementationOnce(() => {
        ctx.docs[0]!.status = 'cancelled'
        return Promise.resolve({ matchedCount: 0 })
      })
      await expect(ctx.service.approve(id, landlord)).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(false)
      expect(ctx.designs.find(d => d.id === 'd-old')?.visible).toBe(true)
    })

    it('does not restore visibility when a concurrent approve already won', async () => {
      const ctx = setup()
      const id = await toDelivered(ctx)
      ctx.requestRepo.updateOne.mockImplementationOnce(() => {
        ctx.docs[0]!.status = 'approved'
        return Promise.resolve({ matchedCount: 0 })
      })
      await expect(ctx.service.approve(id, landlord)).rejects.toBeInstanceOf(
        ConflictException
      )
      expect(ctx.designs.find(d => d.id === 'd-new')?.visible).toBe(true)
    })
  })

  describe('listing', () => {
    it('queue defaults to all non-terminal statuses, oldest updated first', async () => {
      const { service, requestRepo } = setup()
      await service.create(landlord, createDto)
      const out = await service.queue({})
      const arg = requestRepo.findAndCount.mock.calls.at(-1)?.[0] as {
        where: { status: { $in: string[] } }
        order: unknown
      }
      expect(arg.where.status.$in).toEqual([
        'submitted',
        'needs_info',
        'escalated',
        'in_progress',
        'delivered',
        'changes_requested',
      ])
      expect(arg.order).toEqual({ updatedAt: 'ASC' })
      expect(out).toMatchObject({ total: 1, page: 1, limit: 20 })
    })

    it('queue honours a comma separated status filter and rejects bad ones', async () => {
      const { service, requestRepo } = setup()
      await service.queue({ status: 'escalated, rejected', page: 2, limit: 5 })
      const arg = requestRepo.findAndCount.mock.calls.at(-1)?.[0] as {
        where: { status: { $in: string[] } }
        skip: number
        take: number
      }
      expect(arg.where.status.$in).toEqual(['escalated', 'rejected'])
      expect([arg.skip, arg.take]).toEqual([5, 5])
      await expect(service.queue({ status: 'bogus' })).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('batches apartment and landlord lookups (no N+1)', async () => {
      const { service, docs, apartmentRepo, userRepo } = setup()
      await service.create(landlord, createDto)
      const copy = { ...docs[0], _id: new ObjectId() }
      docs.push(copy)
      docs.push({ ...copy, _id: new ObjectId() })
      apartmentRepo.aggregate.mockClear()
      userRepo.aggregate.mockClear()
      const out = await service.listMine(LANDLORD_ID, { status: 'submitted' })
      expect(out.items).toHaveLength(3)
      expect(apartmentRepo.aggregate).toHaveBeenCalledTimes(1)
      expect(userRepo.aggregate).toHaveBeenCalledTimes(1)
    })
  })

  describe('notifications', () => {
    it('submitted and info_provided go to all active staff', async () => {
      const { service, notifications } = setup()
      const { id } = await service.create(landlord, createDto)
      expect(recipientsOf(notifications).sort()).toEqual(
        [STAFF_ID, STAFF_2].sort()
      )
      const first = notifications.createNotificationOnce.mock.calls[0]!
      expect(first[2]).toBeTruthy()
      expect(first[3]).toContain('Căn A1')
      expect(first[4]).toBe('DESIGN_REQUEST')
      expect(first[5]).toEqual({
        requestId: id,
        status: 'submitted',
        link: '/admin/design-requests',
      })
      expect(first[1]).toBe(`design-request:${id}:submitted:0:1`)

      await service.requestInfo(id, staff, { note: 'n' })
      notifications.createNotificationOnce.mockClear()
      await service.reply(id, landlord, { note: 'r' })
      expect(recipientsOf(notifications).sort()).toEqual(
        [STAFF_ID, STAFF_2].sort()
      )
    })

    it('admins are never notified in the staff-only flow', async () => {
      const { service, notifications } = setup()
      const { id } = await service.create(landlord, createDto)
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      await service.feedback(id, landlord, { note: 'a' })
      const all = recipientsOf(notifications)
      expect(all).not.toContain(ADMIN_ID)
      expect(all).not.toContain(ADMIN_2)
    })

    it('started, info_requested, rejected, delivered go to the landlord', async () => {
      const { service, notifications } = setup()
      const a = await service.create(landlord, createDto)
      notifications.createNotificationOnce.mockClear()
      await service.requestInfo(a.id, staff, { note: 'n' })
      expect(recipientsOf(notifications)).toEqual([LANDLORD_ID])
      await service.reply(a.id, landlord, { note: 'r' })
      notifications.createNotificationOnce.mockClear()
      await service.reject(a.id, staff, { note: 'x' })
      expect(recipientsOf(notifications)).toEqual([LANDLORD_ID])

      const b = await service.create(landlord, createDto)
      notifications.createNotificationOnce.mockClear()
      await service.start(b.id, staff)
      expect(recipientsOf(notifications)).toEqual([LANDLORD_ID])
      expect(notifications.createNotificationOnce.mock.calls[0]![2]).toBe(
        'Nhân viên đã bắt đầu thiết kế'
      )
      notifications.createNotificationOnce.mockClear()
      await service.deliver(b.id, staff, { designId: 'd-new' })
      expect(recipientsOf(notifications)).toEqual([LANDLORD_ID])
      expect(notifications.createNotificationOnce.mock.calls[0]![2]).toBe(
        'Thiết kế 3D đã sẵn sàng để duyệt'
      )
    })

    it('feedback goes to the assignee, each round with a fresh dedupe key; approved to the assignee only', async () => {
      const { service, notifications } = setup()
      const { id } = await service.create(landlord, createDto)
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      notifications.createNotificationOnce.mockClear()
      await service.feedback(id, landlord, { note: 'a' })
      expect(recipientsOf(notifications)).toEqual([STAFF_ID])
      const key1 = notifications.createNotificationOnce.mock
        .calls[0]![1] as string
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      notifications.createNotificationOnce.mockClear()
      await service.feedback(id, landlord, { note: 'b' })
      const key2 = notifications.createNotificationOnce.mock
        .calls[0]![1] as string
      expect(key2).not.toBe(key1)
      notifications.createNotificationOnce.mockClear()
      await service.start(id, staff)
      await service.deliver(id, staff, { designId: 'd-new' })
      notifications.createNotificationOnce.mockClear()
      await service.approve(id, landlord)
      expect(recipientsOf(notifications)).toEqual([STAFF_ID])
    })

    it('feedback with no assignee falls back to all staff', async () => {
      const { service, docs, notifications } = setup()
      const { id } = await service.create(landlord, createDto)
      docs[0]!.status = 'delivered'
      docs[0]!.revision = 1
      docs[0]!.assignedAdminId = null
      notifications.createNotificationOnce.mockClear()
      await service.feedback(id, landlord, { note: 'a' })
      expect(recipientsOf(notifications).sort()).toEqual(
        [STAFF_ID, STAFF_2].sort()
      )
    })

    it('queries only active users of the role, capped at 100', async () => {
      const { service, userRepo } = setup()
      await service.create(landlord, createDto)
      expect(userRepo.find).toHaveBeenCalledWith({
        where: { role: 'staff', status: UserStatus.ACTIVE },
        take: 100,
      })
    })

    it('notification failures never fail the request', async () => {
      const { service } = setup({ notifyFails: true })
      const out = await service.create(landlord, createDto)
      expect(out.status).toBe('submitted')
      await expect(service.start(out.id, staff)).resolves.toMatchObject({
        status: 'in_progress',
      })
    })

    it('a failing recipient lookup never fails the request', async () => {
      const ctx = setup()
      ctx.userRepo.find.mockRejectedValue(new Error('db'))
      await expect(
        ctx.service.create(landlord, createDto)
      ).resolves.toMatchObject({ status: 'submitted' })
    })
  })
})
