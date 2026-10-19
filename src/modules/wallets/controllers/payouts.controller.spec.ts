import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { PayoutsController } from './payouts.controller'

type ControllerHandler = (...args: never[]) => unknown

function getControllerHandler(
  name: keyof PayoutsController
): ControllerHandler {
  const handler: unknown = (
    PayoutsController.prototype as unknown as Record<string, unknown>
  )[name]
  if (typeof handler !== 'function') {
    throw new Error(`Missing controller handler: ${name}`)
  }
  return handler as ControllerHandler
}

function setup(): {
  controller: PayoutsController
  service: Record<
    | 'listForLandlord'
    | 'getByTxRefForLandlord'
    | 'getForLandlord'
    | 'retry'
    | 'reportIssue'
    | 'markSettledExternally'
    | 'getContractSummary',
    jest.Mock
  >
} {
  const service = {
    listForLandlord: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getByTxRefForLandlord: jest.fn().mockResolvedValue({ txRef: 'T' }),
    getForLandlord: jest.fn().mockResolvedValue({ id: 'p1' }),
    retry: jest.fn().mockResolvedValue({ status: 'pending' }),
    reportIssue: jest.fn().mockResolvedValue({ directReceipt: false }),
    markSettledExternally: jest
      .fn()
      .mockResolvedValue({ settlement: 'external' }),
    getContractSummary: jest.fn().mockResolvedValue({ contractId: 'c1' }),
  }
  return { controller: new PayoutsController(service as never), service }
}

describe('PayoutsController', () => {
  it('lists the caller payouts with numeric paging', async () => {
    const { controller, service } = setup()

    await controller.listMine({ _id: 'l1' }, '2', '5')

    expect(service.listForLandlord).toHaveBeenCalledWith('l1', 2, 5)
  })

  it('passes NaN paging through for the service to default', async () => {
    const { controller, service } = setup()

    await controller.listMine({ _id: 'l1' })

    expect(service.listForLandlord).toHaveBeenCalledWith(
      'l1',
      Number.NaN,
      Number.NaN
    )
  })

  it('looks a payout up by id and by txRef scoped to the caller', async () => {
    const { controller, service } = setup()

    await controller.getOne('p1', { _id: 'l1' })
    await controller.getByTxRef('T', { _id: 'l1' })

    expect(service.getForLandlord).toHaveBeenCalledWith('p1', 'l1')
    expect(service.getByTxRefForLandlord).toHaveBeenCalledWith('T', 'l1')
  })

  it('delegates admin retry to the service', async () => {
    const { controller, service } = setup()

    await expect(controller.retry('p1')).resolves.toEqual({ status: 'pending' })
    expect(service.retry).toHaveBeenCalledWith('p1')
  })

  it('exposes settlement and restricts the new endpoints by role', async () => {
    const { controller, service } = setup()

    await expect(
      controller.reportIssue('p1', { _id: 'l1' }, { note: 'x' })
    ).resolves.toMatchObject({ settlement: 'relay' })
    expect(service.reportIssue).toHaveBeenCalledWith('p1', 'l1', 'x')
    await controller.markSettledExternally('p1', { note: 'n' })
    expect(service.markSettledExternally).toHaveBeenCalledWith('p1', 'n')

    const reflector = new Reflector()
    expect(
      reflector.get(ROLES_KEY, getControllerHandler('reportIssue'))
    ).toEqual(['landlord'])
    expect(
      reflector.get(ROLES_KEY, getControllerHandler('markSettledExternally'))
    ).toEqual(['admin'])
  })

  it('throws 401 when the token has no user id', () => {
    const { controller } = setup()

    expect(() => controller.listMine({})).toThrow(UnauthorizedException)
    expect(() => controller.getOne('p1', {})).toThrow(UnauthorizedException)
    expect(() => controller.getByTxRef('T', {})).toThrow(UnauthorizedException)
  })

  it('propagates 404 when a payout does not belong to the caller', async () => {
    const { controller, service } = setup()
    service.getForLandlord.mockRejectedValue(
      new NotFoundException('PAYOUT_NOT_FOUND')
    )

    await expect(controller.getOne('p1', { _id: 'l1' })).rejects.toBeInstanceOf(
      NotFoundException
    )
  })

  it('marks retry as admin-only and rejects a landlord with 403', () => {
    const retryHandler = getControllerHandler('retry')
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, retryHandler)
    expect(roles).toEqual(['admin'])

    const guard = new RolesGuard(new Reflector())
    const context = {
      getHandler: (): ControllerHandler => retryHandler,
      getClass: (): typeof PayoutsController => PayoutsController,
      switchToHttp: (): object => ({
        getRequest: (): object => ({
          user: { _id: 'l1', roles: ['landlord'] },
        }),
      }),
    } as unknown as ExecutionContext

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it('scopes the contract summary to the caller landlord and tells the service when the caller is staff/admin', async () => {
    const { controller, service } = setup()

    await controller.getContractSummary('c1', {
      _id: 'l1',
      roles: ['landlord'],
    })
    expect(service.getContractSummary).toHaveBeenCalledWith('c1', {
      userId: 'l1',
      isLandlordScoped: true,
    })

    await controller.getContractSummary('c1', { _id: 's1', roles: ['staff'] })
    expect(service.getContractSummary).toHaveBeenCalledWith('c1', {
      userId: 's1',
      isLandlordScoped: false,
    })
  })

  it('propagates 404 from the summary when the contract is not the caller landlord', async () => {
    const { controller, service } = setup()
    service.getContractSummary.mockRejectedValue(
      new NotFoundException('CONTRACT_NOT_FOUND')
    )

    await expect(
      controller.getContractSummary('c1', { _id: 'l1', roles: ['landlord'] })
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('marks the contract summary as landlord/staff/admin-only and rejects a tenant with 403', () => {
    const handler = getControllerHandler('getContractSummary')
    const roles: unknown = Reflect.getMetadata(ROLES_KEY, handler)
    expect(roles).toEqual(['landlord', 'staff', 'admin'])

    const guard = new RolesGuard(new Reflector())
    const context = {
      getHandler: (): ControllerHandler => handler,
      getClass: (): typeof PayoutsController => PayoutsController,
      switchToHttp: (): object => ({
        getRequest: (): object => ({
          user: { _id: 't1', roles: ['tenant'] },
        }),
      }),
    } as unknown as ExecutionContext

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
  })

  it.each([
    ['listMine', getControllerHandler('listMine')],
    ['getByTxRef', getControllerHandler('getByTxRef')],
    ['getOne', getControllerHandler('getOne')],
  ] as const)(
    'marks %s as landlord-only and rejects a tenant with 403',
    (_name, handler) => {
      const roles: unknown = Reflect.getMetadata(ROLES_KEY, handler)
      expect(roles).toEqual(['landlord'])

      const guard = new RolesGuard(new Reflector())
      const context = {
        getHandler: (): ControllerHandler => handler,
        getClass: (): typeof PayoutsController => PayoutsController,
        switchToHttp: (): object => ({
          getRequest: (): object => ({
            user: { _id: 't1', roles: ['tenant'] },
          }),
        }),
      } as unknown as ExecutionContext

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException)
    }
  )
})
