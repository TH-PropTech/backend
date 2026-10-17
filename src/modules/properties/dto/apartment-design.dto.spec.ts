import { plainToInstance } from 'class-transformer'
import { validate, type ValidationError } from 'class-validator'
import { UpdateApartmentDesignDto } from './apartment-design.dto'

function flattenMessages(error: ValidationError): string[] {
  return [
    ...Object.values(error.constraints ?? {}),
    ...(error.children ?? []).flatMap(flattenMessages),
  ]
}

async function layoutErrors(layout: unknown): Promise<string[]> {
  const dto = plainToInstance(UpdateApartmentDesignDto, { layout })
  const errors = await validate(dto)
  return errors.flatMap(flattenMessages)
}

describe('UpdateApartmentDesignDto layout', () => {
  it('accepts a bounded layout with template overrides and supported extras', async () => {
    const errors = await layoutErrors({
      items: {
        'sofa-1': { x: 1.25, z: 2.5, rot: Math.PI / 2, hidden: false },
      },
      extras: [
        {
          id: 'extra-chair-1',
          kind: 'chair',
          x: 3,
          z: 4,
          rot: 0,
        },
      ],
    })

    expect(errors).toEqual([])
  })

  it.each([
    ['malformed template id', { items: { 'bad id': { x: 1 } }, extras: [] }],
    [
      'unknown furniture kind',
      {
        items: {},
        extras: [{ id: 'extra-1', kind: 'unknown', x: 1, z: 1, rot: 0 }],
      },
    ],
    [
      'duplicate extra ids',
      {
        items: {},
        extras: [
          { id: 'extra-1', kind: 'chair', x: 1, z: 1, rot: 0 },
          { id: 'extra-1', kind: 'sofa', x: 2, z: 2, rot: 0 },
        ],
      },
    ],
    [
      'null coordinate',
      {
        items: {},
        extras: [{ id: 'extra-1', kind: 'chair', x: null, z: 1, rot: 0 }],
      },
    ],
    [
      'out of range coordinate',
      {
        items: {},
        extras: [{ id: 'extra-1', kind: 'chair', x: 41, z: 1, rot: 0 }],
      },
    ],
  ])('rejects %s', async (_name, layout) => {
    const errors = await layoutErrors(layout)

    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects item and extra collections over their limits', async () => {
    const items = Object.fromEntries(
      Array.from({ length: 121 }, (_, index) => [
        `chair-${index}`,
        { x: 1, z: 1 },
      ])
    )
    const extras = Array.from({ length: 61 }, (_, index) => ({
      id: `extra-${index}`,
      kind: 'chair',
      x: 1,
      z: 1,
      rot: 0,
    }))

    await expect(layoutErrors({ items, extras })).resolves.not.toEqual([])
  })

  it('keeps layout optional for legacy design updates', async () => {
    const errors = await validate(
      plainToInstance(UpdateApartmentDesignDto, { visible: true })
    )

    expect(errors).toEqual([])
  })
})
