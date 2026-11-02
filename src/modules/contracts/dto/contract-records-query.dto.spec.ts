import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ContractRecordsQueryDto } from './contract-records-query.dto'

async function errorsFor(input: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ContractRecordsQueryDto, input)
  const errors = await validate(dto)
  return errors.map(error => error.property)
}

describe('ContractRecordsQueryDto', () => {
  it('accepts an empty query and a full valid query', async () => {
    await expect(errorsFor({})).resolves.toEqual([])
    await expect(
      errorsFor({
        property: 'Sunrise',
        tenant: 'Nguyễn',
        landlord: 'Trần',
        status: 'active',
        from: '2026-01-01',
        to: '2026-12-31',
        page: '2',
        pageSize: '50',
      })
    ).resolves.toEqual([])
  })

  it('rejects an unknown status', async () => {
    await expect(errorsFor({ status: 'bogus' })).resolves.toEqual(['status'])
  })

  it('rejects malformed dates', async () => {
    await expect(errorsFor({ from: 'not-a-date' })).resolves.toEqual(['from'])
    await expect(errorsFor({ to: '31/12/2026' })).resolves.toEqual(['to'])
  })

  it('rejects from later than to', async () => {
    await expect(
      errorsFor({ from: '2026-12-31', to: '2026-01-01' })
    ).resolves.toEqual(['to'])
  })

  it('rejects non-positive paging values', async () => {
    await expect(errorsFor({ page: '0' })).resolves.toEqual(['page'])
    await expect(errorsFor({ pageSize: '-5' })).resolves.toEqual(['pageSize'])
  })

  it('rejects over-long text filters', async () => {
    await expect(errorsFor({ tenant: 'a'.repeat(101) })).resolves.toEqual([
      'tenant',
    ])
  })
})
