import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../../common/guards/roles.guard'
import type { UserPayload } from '../../auth/interfaces/auth.interface'
import { PlatformRegulationsController } from './platform-regulations.controller'
import type { PlatformRegulationsService } from '../services/platform-regulations.service'

const ADMIN: UserPayload = { _id: 'admin-1', roles: ['admin'] }

describe('PlatformRegulationsController', () => {
  it('guards the whole controller for admin only', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PlatformRegulationsController)
    ).toEqual(['admin'])
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PlatformRegulationsController)
    ).toEqual([JwtAuthGuard, RolesGuard])
    expect(
      Reflect.getMetadata(PATH_METADATA, PlatformRegulationsController)
    ).toBe('platform-regulations/admin')
  })

  it('passes actor id to service', async () => {
    const service = { update: jest.fn().mockResolvedValue({}) }
    const controller = new PlatformRegulationsController(
      service as unknown as PlatformRegulationsService
    )

    await controller.update('id-1', { isActive: false }, ADMIN)

    expect(service.update).toHaveBeenCalledWith(
      'id-1',
      { isActive: false },
      'admin-1'
    )
  })
})
