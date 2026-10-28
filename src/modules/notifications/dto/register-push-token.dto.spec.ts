import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegisterPushTokenDto } from './register-push-token.dto'

const errorsFor = async (plain: Record<string, unknown>): Promise<string[]> => {
  const errors = await validate(plainToInstance(RegisterPushTokenDto, plain))
  return errors.map(error => error.property)
}

describe('RegisterPushTokenDto', () => {
  it('hợp lệ khi chỉ có token', async () => {
    await expect(
      errorsFor({ token: 'ExponentPushToken[abc]' })
    ).resolves.toEqual([])
  })

  it('hợp lệ với platform ios và android', async () => {
    await expect(errorsFor({ token: 't', platform: 'ios' })).resolves.toEqual(
      []
    )
    await expect(
      errorsFor({ token: 't', platform: 'android' })
    ).resolves.toEqual([])
  })

  it('từ chối thiếu token hoặc token rỗng', async () => {
    await expect(errorsFor({})).resolves.toEqual(['token'])
    await expect(errorsFor({ token: '' })).resolves.toEqual(['token'])
  })

  it('từ chối token không phải chuỗi', async () => {
    await expect(errorsFor({ token: 123 })).resolves.toEqual(['token'])
  })

  it('hợp lệ ở biên 200 ký tự, từ chối 201', async () => {
    await expect(errorsFor({ token: 'a'.repeat(200) })).resolves.toEqual([])
    await expect(errorsFor({ token: 'a'.repeat(201) })).resolves.toEqual([
      'token',
    ])
  })

  it('từ chối platform lạ', async () => {
    await expect(errorsFor({ token: 't', platform: 'web' })).resolves.toEqual([
      'platform',
    ])
  })
})
