import { GUARDS_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { GroqKeysController } from './groq-keys.controller'

describe('GroqKeysController', () => {
  it('requires JWT auth and the admin role on the controller', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GroqKeysController)).toEqual([
      'admin',
    ])
    expect(Reflect.getMetadata(GUARDS_METADATA, GroqKeysController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ])
  })
})
