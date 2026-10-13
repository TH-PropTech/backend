import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  CreateLegalSourceDto,
  ListLegalSourcesQueryDto,
  UpdateLegalSourceDto,
} from './legal-source.dto'
import { CreatePlatformRegulationDto } from './platform-regulation.dto'

/** Cùng option với global ValidationPipe trong setup-app.ts */
async function errorsOf<T extends object>(
  cls: new () => T,
  plain: object
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  })
  const flatten = (list: typeof errors, prefix = ''): string[] =>
    list.flatMap(e => [
      ...(e.constraints ? [`${prefix}${e.property}`] : []),
      ...flatten(e.children ?? [], `${prefix}${e.property}.`),
    ])
  return flatten(errors)
}

const VALID_SOURCE = {
  key: 'residence-law-2020',
  kind: 'legal_text',
  code: 'Luật 68/2020/QH14',
  title: 'Luật Cư trú 2020',
  subtitle: '',
  agency: 'Quốc hội',
  duration: '',
  fee: '',
  externalUrl: 'https://vanban.chinhphu.vn/?pageid=27160&docid=200519',
  icon: 'law',
  description: 'Mô tả',
  dossierItems: [{ title: 'Hồ sơ', detail: 'Chi tiết' }],
  steps: [{ step: 1, title: 'Bước 1', detail: 'Làm' }],
  legalGrounds: [
    { title: 'Điều 27', article: 'Khoản 1', url: 'https://vbpl.vn/x' },
  ],
  notes: ['Ghi chú'],
}

describe('Legal source DTO validation', () => {
  it('accepts a valid source', async () => {
    expect(await errorsOf(CreateLegalSourceDto, VALID_SOURCE)).toEqual([])
  })

  it.each([
    ['http externalUrl', { externalUrl: 'http://vanban.chinhphu.vn/' }],
    ['relative externalUrl', { externalUrl: '/van-ban' }],
    ['javascript externalUrl', { externalUrl: 'javascript:alert(1)' }],
  ])('rejects %s', async (_label, patch) => {
    expect(
      await errorsOf(CreateLegalSourceDto, { ...VALID_SOURCE, ...patch })
    ).toContain('externalUrl')
  })

  it('rejects non-https legal ground url', async () => {
    const errors = await errorsOf(CreateLegalSourceDto, {
      ...VALID_SOURCE,
      legalGrounds: [{ title: 'A', article: 'B', url: 'http://x.vn' }],
    })
    expect(errors).toContain('legalGrounds.0.url')
  })

  it.each([
    ['uppercase key', { key: 'Housing' }],
    ['key with slash', { key: 'a/b' }],
    ['unknown kind', { kind: 'decree' }],
    ['unknown icon', { icon: 'rocket' }],
  ])('rejects %s', async (_label, patch) => {
    const errors = await errorsOf(CreateLegalSourceDto, {
      ...VALID_SOURCE,
      ...patch,
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects key in update payload (key is immutable)', async () => {
    expect(
      await errorsOf(UpdateLegalSourceDto, { key: 'x1', title: 'Mới' })
    ).toContain('key')
  })

  it('accepts partial update', async () => {
    expect(
      await errorsOf(UpdateLegalSourceDto, { showInContractPanel: true })
    ).toEqual([])
  })

  it('only accepts panel=contract', async () => {
    expect(await errorsOf(ListLegalSourcesQueryDto, { panel: 'x' })).toContain(
      'panel'
    )
    expect(
      await errorsOf(ListLegalSourcesQueryDto, { panel: 'contract' })
    ).toEqual([])
  })
})

describe('Platform regulation DTO validation', () => {
  const VALID = {
    code: 'REG-RES-01',
    title: 'Tạm trú',
    summary: 'Tóm tắt',
    category: 'residence',
    severity: 'mandatory',
    scope: ['all'],
    linkedSourceKey: '1.004194',
    checklistItems: [{ id: 'c1', label: 'Làm' }],
  }

  it('accepts valid regulation and null link', async () => {
    expect(await errorsOf(CreatePlatformRegulationDto, VALID)).toEqual([])
    expect(
      await errorsOf(CreatePlatformRegulationDto, {
        ...VALID,
        linkedSourceKey: null,
      })
    ).toEqual([])
  })

  it.each([
    ['unknown category', { category: 'x' }],
    ['unknown scope', { scope: ['castle'] }],
    ['empty scope', { scope: [] }],
    ['checklist item without label', { checklistItems: [{ id: 'c1' }] }],
  ])('rejects %s', async (_label, patch) => {
    expect(
      (await errorsOf(CreatePlatformRegulationDto, { ...VALID, ...patch }))
        .length
    ).toBeGreaterThan(0)
  })
})
