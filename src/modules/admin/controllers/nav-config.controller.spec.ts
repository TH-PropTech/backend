import 'reflect-metadata'
import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { UpdateNavConfigDto } from '../dto/update-nav-config.dto'
import { NavConfigController } from './nav-config.controller'

function handlerOf(name: 'get' | 'update'): (...args: never[]) => unknown {
  return NavConfigController.prototype[name]
}

function guardAllows(name: 'get' | 'update', roles: string[]): boolean {
  const guard = new RolesGuard(new Reflector())
  const ctx = {
    getHandler: (): unknown => handlerOf(name),
    getClass: (): unknown => NavConfigController,
    switchToHttp: (): unknown => ({
      getRequest: (): unknown => ({ user: { roles } }),
    }),
  } as unknown as ExecutionContext
  return guard.canActivate(ctx)
}

describe('NavConfigController', () => {
  it('declares who may read and who may write', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf('get'))).toEqual([
      'staff',
      'admin',
    ])
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf('update'))).toEqual([
      'admin',
    ])
  })

  it('RolesGuard: staff may read but not write; landlord may do neither', () => {
    expect(guardAllows('get', ['staff'])).toBe(true)
    expect(guardAllows('update', ['admin'])).toBe(true)
    expect(() => guardAllows('update', ['staff'])).toThrow(ForbiddenException)
    expect(() => guardAllows('get', ['landlord'])).toThrow(ForbiddenException)
  })

  it('passes the dto and the admin email to the service', async () => {
    const service = {
      get: jest.fn().mockResolvedValue({ hiddenForStaff: [] }),
      update: jest.fn().mockResolvedValue({ hiddenForStaff: ['community'] }),
    }
    const controller = new NavConfigController(service as never)
    await controller.update({ hiddenForStaff: ['community'] }, 'a@x.vn')
    expect(service.update).toHaveBeenCalledWith(['community'], 'a@x.vn')
    await controller.get()
    expect(service.get).toHaveBeenCalled()
  })
})

describe('UpdateNavConfigDto', () => {
  const errorsOf = async (value: unknown): Promise<number> =>
    (await validate(plainToInstance(UpdateNavConfigDto, value as object)))
      .length

  it('accepts a list of kebab-case ids, including an empty list', async () => {
    expect(
      await errorsOf({ hiddenForStaff: ['community', 'support-tickets'] })
    ).toBe(0)
    expect(await errorsOf({ hiddenForStaff: [] })).toBe(0)
  })

  it('rejects non-arrays, non-strings and ids with illegal characters', async () => {
    expect(await errorsOf({})).toBeGreaterThan(0)
    expect(await errorsOf({ hiddenForStaff: 'community' })).toBeGreaterThan(0)
    expect(await errorsOf({ hiddenForStaff: [1] })).toBeGreaterThan(0)
    expect(await errorsOf({ hiddenForStaff: ['../etc'] })).toBeGreaterThan(0)
    expect(await errorsOf({ hiddenForStaff: ['Community'] })).toBeGreaterThan(0)
  })

  it('rejects more than 64 ids', async () => {
    const many = Array.from({ length: 65 }, (_, i) => `tab-${i}`)
    expect(await errorsOf({ hiddenForStaff: many })).toBeGreaterThan(0)
  })
})
