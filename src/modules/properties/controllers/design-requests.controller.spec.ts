import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { DesignRequestsController } from './design-requests.controller'

type Handler = (...args: never[]) => unknown

function handlerOf(name: keyof DesignRequestsController): Handler {
  const h: unknown = (
    DesignRequestsController.prototype as unknown as Record<string, unknown>
  )[name]
  if (typeof h !== 'function') throw new Error(`missing ${name}`)
  return h as Handler
}

function guardAllows(
  name: keyof DesignRequestsController,
  roles: string[]
): boolean {
  const handler = handlerOf(name)
  const guard = new RolesGuard(new Reflector())
  const context = {
    getHandler: (): Handler => handler,
    getClass: (): typeof DesignRequestsController => DesignRequestsController,
    switchToHttp: (): object => ({
      getRequest: (): object => ({ user: { _id: 'u1', roles } }),
    }),
  } as unknown as ExecutionContext
  return guard.canActivate(context)
}

function setup(): {
  controller: DesignRequestsController
  service: Record<string, ReturnType<typeof jest.fn>>
} {
  const names = [
    'create',
    'listMine',
    'queue',
    'getById',
    'reply',
    'approve',
    'feedback',
    'cancel',
    'requestInfo',
    'reject',
    'start',
    'deliver',
  ] as const
  const service = Object.fromEntries(
    names.map(n => [n, jest.fn().mockResolvedValue({ ok: n })])
  ) as Record<(typeof names)[number], ReturnType<typeof jest.fn>>
  return { controller: new DesignRequestsController(service as never), service }
}

describe('DesignRequestsController', () => {
  it('maps the actor role (admin > staff > landlord) for staff-side endpoints', async () => {
    const { controller, service } = setup()
    await controller.start('r1', { _id: 'a1', roles: ['staff', 'admin'] })
    expect(service.start).toHaveBeenCalledWith('r1', {
      id: 'a1',
      role: 'admin',
    })
    await controller.reject(
      'r1',
      { note: 'x' },
      { _id: 's1', roles: ['staff'] }
    )
    expect(service.reject).toHaveBeenCalledWith(
      'r1',
      { id: 's1', role: 'staff' },
      { note: 'x' }
    )
    await controller.getOne('r1', { _id: 'l1', roles: ['landlord'] })
    expect(service.getById).toHaveBeenCalledWith('r1', {
      id: 'l1',
      role: 'landlord',
    })
  })

  it('landlord endpoints always act as the landlord owner', async () => {
    const { controller, service } = setup()
    await controller.approve('r1', { _id: 'l1', roles: ['landlord', 'admin'] })
    expect(service.approve).toHaveBeenCalledWith('r1', {
      id: 'l1',
      role: 'landlord',
    })
    await controller.listMine({ page: 2 }, { _id: 'l1' })
    expect(service.listMine).toHaveBeenCalledWith('l1', { page: 2 })
  })

  it('throws 401 when the token has no user id', () => {
    const { controller } = setup()
    expect(() => controller.cancel('r1', {})).toThrow(UnauthorizedException)
    expect(() => controller.getOne('r1', {})).toThrow(UnauthorizedException)
  })

  it('declares my and queue before :id', () => {
    const proto = DesignRequestsController.prototype
    const order = Object.getOwnPropertyNames(proto)
    expect(order.indexOf('listMine')).toBeLessThan(order.indexOf('getOne'))
    expect(order.indexOf('queue')).toBeLessThan(order.indexOf('getOne'))
  })

  it.each([
    ['start', ['staff', 'admin']],
    ['deliver', ['staff', 'admin']],
    ['create', ['landlord']],
    ['listMine', ['landlord']],
    ['reply', ['landlord']],
    ['approve', ['landlord']],
    ['feedback', ['landlord']],
    ['cancel', ['landlord']],
    ['queue', ['staff', 'admin']],
    ['requestInfo', ['staff', 'admin']],
    ['reject', ['staff', 'admin']],
    ['getOne', ['landlord', 'staff', 'admin']],
  ] as const)('%s has @Roles %j', (name, expected) => {
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, handlerOf(name))
    expect(roles).toEqual(expected)
  })

  it('RolesGuard: staff and admin may start/deliver, landlord gets 403', () => {
    expect(() => guardAllows('start', ['landlord'])).toThrow(ForbiddenException)
    expect(() => guardAllows('deliver', ['landlord'])).toThrow(
      ForbiddenException
    )
    expect(guardAllows('start', ['staff'])).toBe(true)
    expect(guardAllows('deliver', ['staff'])).toBe(true)
    expect(guardAllows('start', ['admin'])).toBe(true)
    expect(guardAllows('deliver', ['admin'])).toBe(true)
    expect(() => guardAllows('queue', ['landlord'])).toThrow(ForbiddenException)
  })
})
