import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { LegalSourcesController } from './legal-sources.controller'
import type { LegalSourcesService } from '../services/legal-sources.service'

type Handler = keyof LegalSourcesController

function handlerMeta<T>(key: string, handler: Handler): T | undefined {
  const fn = LegalSourcesController.prototype[handler] as unknown as object
  return Reflect.getMetadata(key, fn) as T | undefined
}

const ADMIN_HANDLERS: Handler[] = [
  'findAllAdmin',
  'create',
  'reorder',
  'update',
  'remove',
]
const PUBLIC_HANDLERS: Handler[] = ['findPublic', 'findPublicByKey']

const ADMIN: UserPayload = { _id: 'admin-1', roles: ['admin'] }

describe('LegalSourcesController', () => {
  it.each(ADMIN_HANDLERS)('%s requires admin role with JWT guards', h => {
    expect(handlerMeta<string[]>(ROLES_KEY, h)).toEqual(['admin'])
    expect(handlerMeta<unknown[]>(GUARDS_METADATA, h)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ])
  })

  it.each(PUBLIC_HANDLERS)('%s is public', h => {
    expect(handlerMeta(ROLES_KEY, h)).toBeUndefined()
    expect(handlerMeta(GUARDS_METADATA, h)).toBeUndefined()
  })

  it('declares admin routes before the public :key route', () => {
    const handlers = Object.getOwnPropertyNames(
      LegalSourcesController.prototype
    )
    expect(handlers.indexOf('findAllAdmin')).toBeLessThan(
      handlers.indexOf('findPublicByKey')
    )
    expect(handlerMeta(PATH_METADATA, 'findPublicByKey')).toBe(':key')
  })

  it('delegates with panel filter and actor id', async () => {
    const service = {
      findPublic: jest.fn().mockResolvedValue([]),
      reorder: jest.fn().mockResolvedValue([]),
    }
    const controller = new LegalSourcesController(
      service as unknown as LegalSourcesService
    )

    await controller.findPublic({ panel: 'contract' })
    await controller.reorder({ keys: ['a', 'b'] }, ADMIN)

    expect(service.findPublic).toHaveBeenCalledWith('contract')
    expect(service.reorder).toHaveBeenCalledWith(['a', 'b'], 'admin-1')
  })
})
