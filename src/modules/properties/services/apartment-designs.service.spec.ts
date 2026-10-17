import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import {
  MAX_APARTMENT_DESIGNS,
  type ApartmentDesignEntry,
} from '../schemas/apartment.schema'
import { ApartmentDesignsService } from './apartment-designs.service'

const APARTMENT_ID = '507f1f77bcf86cd799439011'

function entry(
  over: Partial<ApartmentDesignEntry> & Pick<ApartmentDesignEntry, 'id'>
): ApartmentDesignEntry {
  return {
    name: 'Thiết kế',
    description: '',
    theme: 'modern',
    palette: {},
    furnishing: null,
    defaultHour: 10,
    visible: true,
    order: 0,
    createdBy: 'admin-1',
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
    ...over,
  }
}

function build(
  designs: ApartmentDesignEntry[] = [],
  opts: { found?: boolean; matched?: number } = {}
): {
  service: ApartmentDesignsService
  repo: Record<'updateOne' | 'aggregate', jest.Mock>
} {
  const repo = {
    updateOne: jest.fn().mockResolvedValue({ matchedCount: opts.matched ?? 1 }),
    aggregate: jest.fn().mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue(
          opts.found === false ? [] : [{ floorplanDesigns: designs }]
        ),
    }),
  }
  return { service: new ApartmentDesignsService(repo as never), repo }
}

describe('ApartmentDesignsService', () => {
  it('lists only visible designs, ordered, without admin fields', async () => {
    const { service } = build([
      entry({ id: 'b', name: 'B', order: 2 }),
      entry({ id: 'hidden', name: 'Ẩn', visible: false }),
      entry({ id: 'a', name: 'A', order: 1, theme: 'warm' }),
    ])

    const list = await service.listVisible(APARTMENT_ID)

    expect(list.map(d => d.id)).toEqual(['a', 'b'])
    expect(list[0]).toEqual({
      id: 'a',
      name: 'A',
      description: '',
      theme: 'warm',
      palette: {},
      furnishing: null,
      defaultHour: 10,
      layout: { items: {}, extras: [] },
    })
    expect(list[0]).not.toHaveProperty('visible')
  })

  it('lists hidden designs for admin as well', async () => {
    const { service } = build([
      entry({ id: 'a' }),
      entry({ id: 'h', visible: false, order: 1 }),
    ])

    const list = await service.listAll(APARTMENT_ID)

    expect(list.map(d => [d.id, d.visible])).toEqual([
      ['a', true],
      ['h', false],
    ])
  })

  it('returns an empty list for an apartment that has no designs yet', async () => {
    const { service } = build([])
    await expect(service.listVisible(APARTMENT_ID)).resolves.toEqual([])
  })

  it('rejects an unknown apartment and an invalid id', async () => {
    await expect(
      build([], { found: false }).service.listVisible(APARTMENT_ID)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      build().service.listVisible('not-an-id')
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('creates a design with an atomic capped push and sanitises the palette', async () => {
    const { service, repo } = build([entry({ id: 'x' })])

    const created = await service.create(
      APARTMENT_ID,
      {
        name: '  Bắc Âu sáng  ',
        theme: 'nordic',
        palette: { floor: '#AABBCC', wall: 'red' },
      },
      'admin-9'
    )

    expect(created).toMatchObject({
      name: 'Bắc Âu sáng',
      theme: 'nordic',
      palette: { floor: '#aabbcc' },
      visible: true,
      order: 1,
      defaultHour: 10,
      furnishing: null,
    })
    const [filter, update] = repo.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $push: { floorplanDesigns: ApartmentDesignEntry } },
    ]
    expect(String(filter['_id'])).toBe(APARTMENT_ID)
    expect(filter[`floorplanDesigns.${MAX_APARTMENT_DESIGNS - 1}`]).toEqual({
      $exists: false,
    })
    expect(update.$push.floorplanDesigns.createdBy).toBe('admin-9')
    expect(ObjectId.isValid(update.$push.floorplanDesigns.id)).toBe(true)
  })

  it('answers 409 when the apartment already holds the maximum number of designs', async () => {
    const { service } = build([], { matched: 0 })
    await expect(
      service.create(APARTMENT_ID, { name: 'Z', theme: 'warm' }, 'admin-1')
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('toggles visibility with a positional $set and returns the updated design', async () => {
    const { service, repo } = build([entry({ id: 'd1', visible: false })])

    const updated = await service.update(APARTMENT_ID, 'd1', {
      visible: false,
    })

    const [filter, update] = repo.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ]
    expect(filter['floorplanDesigns.id']).toBe('d1')
    expect(update.$set['floorplanDesigns.$.visible']).toBe(false)
    expect(update.$set['floorplanDesigns.$.updatedAt']).toBeInstanceOf(Date)
    expect(updated.visible).toBe(false)
  })

  it('persists and returns a normalized layout with a positional $set', async () => {
    const layout = {
      items: { 'sofa-1': { x: 1.23456, hidden: true } },
      extras: [
        {
          id: 'extra-chair-1',
          kind: 'chair',
          x: 2.34567,
          z: 3.45678,
          rot: Math.PI * 3,
        },
      ],
    }
    const { service, repo } = build([
      entry({ id: 'd1', layout: layout as never }),
    ])

    const updated = await service.update(APARTMENT_ID, 'd1', {
      layout,
    } as never)

    const [, update] = repo.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ]
    expect(update.$set['floorplanDesigns.$.layout']).toEqual({
      items: { 'sofa-1': { x: 1.235, hidden: true } },
      extras: [
        {
          id: 'extra-chair-1',
          kind: 'chair',
          x: 2.346,
          z: 3.457,
          rot: 3.1416,
        },
      ],
    })
    expect(updated.layout).toEqual(update.$set['floorplanDesigns.$.layout'])
  })

  it('normalizes malformed historic layout entries in public responses', async () => {
    const { service } = build([
      entry({
        id: 'd1',
        layout: {
          items: {
            'sofa-1': { x: 2, z: Number.NaN },
            'bad id': { x: 1 },
          },
          extras: [
            { id: 'extra-1', kind: 'chair', x: 2, z: 3, rot: 0 },
            { id: 'extra-1', kind: 'sofa', x: 4, z: 5, rot: 0 },
            { id: 'extra-2', kind: 'unknown', x: 1, z: 1, rot: 0 },
          ],
        } as never,
      }),
    ])

    const [design] = await service.listVisible(APARTMENT_ID)

    expect(design?.layout).toEqual({
      items: { 'sofa-1': { x: 2 } },
      extras: [{ id: 'extra-1', kind: 'chair', x: 2, z: 3, rot: 0 }],
    })
  })

  it('answers 404 when updating or removing a design that does not exist', async () => {
    const { service } = build([], { matched: 0 })
    await expect(
      service.update(APARTMENT_ID, 'nope', { visible: true })
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.remove(APARTMENT_ID, 'nope')).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('removes a design with $pull', async () => {
    const { service, repo } = build()
    await service.remove(APARTMENT_ID, 'd1')
    const [, update] = repo.updateOne.mock.calls[0] as [
      unknown,
      { $pull: { floorplanDesigns: { id: string } } },
    ]
    expect(update.$pull.floorplanDesigns).toEqual({ id: 'd1' })
  })

  it('refuses a blank name on update', async () => {
    const { service } = build([entry({ id: 'd1' })])
    await expect(
      service.update(APARTMENT_ID, 'd1', { name: '   ' })
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
