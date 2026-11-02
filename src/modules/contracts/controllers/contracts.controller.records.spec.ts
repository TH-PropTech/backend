import 'reflect-metadata'
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ContractsController } from './contracts.controller'
import { RolesGuard } from '../../../common/guards/roles.guard'

type Handler = () => unknown

function handlerOf(name: string): Handler {
  return (ContractsController.prototype as unknown as Record<string, Handler>)[
    name
  ] as Handler
}

function build(recordsService?: unknown): ContractsController {
  return new ContractsController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    recordsService as never
  )
}

describe('ContractsController admin contract records', () => {
  it('delegates the query to the records service', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 20 }
    const recordsService = { listRecords: jest.fn().mockResolvedValue(page) }
    const query = { tenant: 'Nguyễn', status: 'active' as const, page: 2 }

    await expect(build(recordsService).listRecords(query)).resolves.toBe(page)
    expect(recordsService.listRecords).toHaveBeenCalledWith(query)
  })

  it('reports the feature as unavailable when the service is not wired', async () => {
    await expect(build().listRecords({})).rejects.toBeInstanceOf(
      ServiceUnavailableException
    )
  })

  describe('contract (route order and roles)', () => {
    it('is declared at path "records" before the ":id" routes so it is not captured as an id', () => {
      expect(Reflect.getMetadata('path', handlerOf('listRecords'))).toBe(
        'records'
      )
      const order = Object.getOwnPropertyNames(ContractsController.prototype)
      expect(order.indexOf('listRecords')).toBeGreaterThan(-1)
      expect(order.indexOf('listRecords')).toBeLessThan(
        order.indexOf('findOne')
      )
    })

    const guard = new RolesGuard(new Reflector())
    const allows = (roles: string[]): boolean => {
      try {
        return guard.canActivate({
          getHandler: (): unknown => handlerOf('listRecords'),
          getClass: (): unknown => ContractsController,
          switchToHttp: (): unknown => ({
            getRequest: (): unknown => ({ user: { roles } }),
          }),
        } as unknown as ExecutionContext)
      } catch (error) {
        if (error instanceof ForbiddenException) return false
        throw error
      }
    }

    it('is open only to admin and staff', () => {
      expect(allows(['admin'])).toBe(true)
      expect(allows(['staff'])).toBe(true)
      expect(allows(['landlord'])).toBe(false)
      expect(allows(['tenant'])).toBe(false)
      expect(allows([])).toBe(false)
    })
  })
})
