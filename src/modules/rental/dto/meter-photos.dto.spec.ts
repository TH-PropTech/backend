import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RecordHandoverDto } from './move-in-handover.dto'
import { RecordMoveOutHandoverDto } from './move-out-handover.dto'

const base = {
  handedOverAt: '2030-02-01T09:00:00.000Z',
  electricity: 120,
  water: 30,
  keyCount: 2,
}
const photos = {
  electricity: ['https://cdn.example.com/dien.jpg'],
  water: ['https://cdn.example.com/nuoc.png'],
}

async function messages(
  cls: new () => object,
  payload: object
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload))
  const collect = (list: typeof errors): string[] =>
    list.flatMap(error => [
      ...Object.values(error.constraints ?? {}),
      ...collect(error.children ?? []),
    ])
  return collect(errors)
}

describe.each([
  ['move-in handover', RecordHandoverDto, base],
  [
    'move-out handover',
    RecordMoveOutHandoverDto,
    { ...base, handedBackAt: base.handedOverAt },
  ],
])('%s meter photos', (_label, cls, payload) => {
  it('accepts one photo per meter', async () => {
    expect(await messages(cls, { ...payload, meterPhotos: photos })).toEqual([])
  })

  it('accepts a handover without photos', async () => {
    expect(await messages(cls, payload)).toEqual([])
  })

  it('accepts a meter with no photo when the other has one', async () => {
    expect(
      await messages(cls, {
        ...payload,
        meterPhotos: { electricity: [], water: photos.water },
      })
    ).toEqual([])
  })

  it('rejects non-image files and more than three photos', async () => {
    const found = await messages(cls, {
      ...payload,
      meterPhotos: {
        electricity: ['https://cdn.example.com/dien.pdf'],
        water: Array.from(
          { length: 4 },
          (_, i) => `https://cdn.example.com/${i}.jpg`
        ),
      },
    })
    expect(found).toContain('Ảnh công tơ điện phải là tệp JPEG hoặc PNG.')
    expect(found).toContain('Tối đa 3 ảnh công tơ nước.')
  })
})
