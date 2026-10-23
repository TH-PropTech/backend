import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { LegalKnowledgeController } from './legal-knowledge.controller'

describe('LegalKnowledgeController', () => {
  it('requires JWT auth and the admin role on the controller', () => {
    expect(Reflect.getMetadata(ROLES_KEY, LegalKnowledgeController)).toEqual([
      'admin',
    ])
    expect(
      Reflect.getMetadata(GUARDS_METADATA, LegalKnowledgeController)
    ).toEqual([JwtAuthGuard, RolesGuard])
  })

  it('exposes the admin routes from the HTTP contract', () => {
    const routes = Object.getOwnPropertyNames(
      LegalKnowledgeController.prototype
    )
      .filter(name => name !== 'constructor')
      .map(name => {
        const handler =
          LegalKnowledgeController.prototype[
            name as keyof LegalKnowledgeController
          ]
        return {
          name,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as number,
          path: Reflect.getMetadata(PATH_METADATA, handler) as string,
        }
      })
      .map(route => `${route.method}:${route.path}`)

    expect(routes.sort()).toEqual(
      [
        '0:admin',
        '0:admin/:id',
        '1:admin/fetch',
        '1:admin/search',
        '1:admin/publish-batch',
        '1:admin',
        '3:admin/:id',
        '1:admin/:id/publish',
        '1:admin/:id/unpublish',
        '4:admin/:id',
      ].sort()
    )
  })
})
