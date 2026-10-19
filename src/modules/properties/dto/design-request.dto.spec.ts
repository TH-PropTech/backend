import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import {
  CreateDesignRequestDto,
  DeliverDesignRequestDto,
  DesignRequestNoteDto,
  DesignRequestQueueQueryDto,
  MyDesignRequestsQueryDto,
  parseDesignRequestStatuses,
} from './design-request.dto'

async function errorsOf<T extends object>(
  cls: new () => T,
  plain: object
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain))
  return errors.map(e => e.property)
}

const base = { apartmentId: 'a1', kind: 'create', brief: 'Muốn thiết kế' }

describe('CreateDesignRequestDto', () => {
  it('accepts a valid create request', async () => {
    expect(await errorsOf(CreateDesignRequestDto, base)).toEqual([])
  })

  it('requires brief within 1..2000 after trimming', async () => {
    expect(
      await errorsOf(CreateDesignRequestDto, { ...base, brief: '   ' })
    ).toContain('brief')
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        brief: 'x'.repeat(2001),
      })
    ).toContain('brief')
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        brief: 'x'.repeat(2000),
      })
    ).toEqual([])
  })

  it('requires targetDesignId when kind is edit', async () => {
    expect(
      await errorsOf(CreateDesignRequestDto, { ...base, kind: 'edit' })
    ).toContain('targetDesignId')
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        kind: 'edit',
        targetDesignId: 'd1',
      })
    ).toEqual([])
  })

  it('rejects an unknown kind', async () => {
    expect(
      await errorsOf(CreateDesignRequestDto, { ...base, kind: 'delete' })
    ).toContain('kind')
  })

  it('only accepts https attachments, at most 10', async () => {
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        attachmentUrls: ['https://x.vn/a.png'],
      })
    ).toEqual([])
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        attachmentUrls: ['http://x.vn/a.png'],
      })
    ).toContain('attachmentUrls')
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        attachmentUrls: ['javascript:alert(1)'],
      })
    ).toContain('attachmentUrls')
    expect(
      await errorsOf(CreateDesignRequestDto, {
        ...base,
        attachmentUrls: Array.from({ length: 11 }, () => 'https://x.vn/a.png'),
      })
    ).toContain('attachmentUrls')
  })
})

describe('DesignRequestNoteDto / DeliverDesignRequestDto', () => {
  it('requires a non-empty note up to 2000 chars', async () => {
    expect(await errorsOf(DesignRequestNoteDto, { note: ' ' })).toContain(
      'note'
    )
    expect(await errorsOf(DesignRequestNoteDto, {})).toContain('note')
    expect(
      await errorsOf(DesignRequestNoteDto, { note: 'x'.repeat(2001) })
    ).toContain('note')
    expect(await errorsOf(DesignRequestNoteDto, { note: 'ok' })).toEqual([])
  })

  it('deliver needs designId, note optional but bounded', async () => {
    expect(await errorsOf(DeliverDesignRequestDto, {})).toContain('designId')
    expect(await errorsOf(DeliverDesignRequestDto, { designId: 'd' })).toEqual(
      []
    )
    expect(
      await errorsOf(DeliverDesignRequestDto, {
        designId: 'd',
        note: 'x'.repeat(2001),
      })
    ).toContain('note')
  })
})

describe('queries', () => {
  it('queue status must be a comma separated list of known statuses', async () => {
    expect(await errorsOf(DesignRequestQueueQueryDto, {})).toEqual([])
    expect(
      await errorsOf(DesignRequestQueueQueryDto, {
        status: 'escalated,in_progress',
      })
    ).toEqual([])
    expect(
      await errorsOf(DesignRequestQueueQueryDto, { status: 'escalated,bogus' })
    ).toContain('status')
    expect(
      await errorsOf(DesignRequestQueueQueryDto, { status: ',' })
    ).toContain('status')
  })

  it('parses status lists', () => {
    expect(parseDesignRequestStatuses(undefined)).toEqual([])
    expect(parseDesignRequestStatuses('a')).toBeNull()
    expect(parseDesignRequestStatuses('approved, approved')).toEqual([
      'approved',
    ])
  })

  it('my query validates status enum and paging', async () => {
    expect(
      await errorsOf(MyDesignRequestsQueryDto, { status: 'delivered' })
    ).toEqual([])
    expect(await errorsOf(MyDesignRequestsQueryDto, { status: 'x' })).toContain(
      'status'
    )
    expect(
      await errorsOf(MyDesignRequestsQueryDto, { limit: '500' })
    ).toContain('limit')
    expect(await errorsOf(MyDesignRequestsQueryDto, { page: '0' })).toContain(
      'page'
    )
  })
})
