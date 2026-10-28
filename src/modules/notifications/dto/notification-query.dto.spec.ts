import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { NotificationQueryDto } from './notification-query.dto'

const errorsFor = async (plain: Record<string, unknown>): Promise<string[]> => {
  const errors = await validate(plainToInstance(NotificationQueryDto, plain))
  return errors.map(error => error.property)
}

describe('NotificationQueryDto', () => {
  it('hợp lệ khi để trống (dùng mặc định)', async () => {
    await expect(errorsFor({})).resolves.toEqual([])
  })

  it('hợp lệ ở biên: limit 1 và 50, page 1', async () => {
    await expect(errorsFor({ limit: '1', page: '1' })).resolves.toEqual([])
    await expect(errorsFor({ limit: '50' })).resolves.toEqual([])
  })

  it('từ chối limit vượt 50', async () => {
    await expect(errorsFor({ limit: '500' })).resolves.toEqual(['limit'])
  })

  it('từ chối limit 0, page 0 hoặc số thập phân', async () => {
    await expect(errorsFor({ limit: '0' })).resolves.toEqual(['limit'])
    await expect(errorsFor({ page: '0' })).resolves.toEqual(['page'])
    await expect(errorsFor({ page: '1.5' })).resolves.toEqual(['page'])
  })

  it('từ chối limit không phải số', async () => {
    await expect(errorsFor({ limit: 'abc' })).resolves.toEqual(['limit'])
  })

  it('chỉ nhận isRead là "true" hoặc "false"', async () => {
    await expect(errorsFor({ isRead: 'true' })).resolves.toEqual([])
    await expect(errorsFor({ isRead: 'false' })).resolves.toEqual([])
    await expect(errorsFor({ isRead: 'yes' })).resolves.toEqual(['isRead'])
  })
})
