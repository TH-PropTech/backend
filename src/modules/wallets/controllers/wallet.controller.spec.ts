import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { ReceivingStatusQueryDto } from '../dto/wallet.dto'
import { WalletController } from './wallet.controller'

function setup(): {
  controller: WalletController
  wallets: Record<'getReceivingStatus', jest.Mock>
} {
  const wallets = {
    getReceivingStatus: jest.fn().mockResolvedValue({ accounts: [] }),
  }
  return {
    controller: new WalletController(wallets as never, {} as never),
    wallets,
  }
}

describe('WalletController.receivingStatus', () => {
  it('passes refresh=true through and defaults to false', async () => {
    const { controller, wallets } = setup()

    await controller.receivingStatus({ refresh: true }, { _id: 'l1' })
    await controller.receivingStatus({}, { _id: 'l1' })

    expect(wallets.getReceivingStatus).toHaveBeenNthCalledWith(1, 'l1', true)
    expect(wallets.getReceivingStatus).toHaveBeenNthCalledWith(2, 'l1', false)
  })

  it('throws 401 without a user id', () => {
    const { controller } = setup()

    expect(() => controller.receivingStatus({}, {})).toThrow(
      UnauthorizedException
    )
  })

  it('parses the refresh query string to a boolean', () => {
    const parse = (value: unknown): boolean | undefined =>
      plainToInstance(ReceivingStatusQueryDto, { refresh: value }).refresh

    expect(parse('true')).toBe(true)
    expect(parse('1')).toBe(true)
    expect(parse('false')).toBe(false)
    expect(parse('nope')).toBe(false)
  })

  it('is landlord-only; tenant gets 403', () => {
    const handler: unknown = (
      WalletController.prototype as unknown as Record<string, unknown>
    ).receivingStatus
    expect(Reflect.getMetadata(ROLES_KEY, WalletController)).toEqual([
      'landlord',
    ])
    const guard = new RolesGuard(new Reflector())
    const contextFor = (role: string): ExecutionContext =>
      ({
        getHandler: (): unknown => handler,
        getClass: (): typeof WalletController => WalletController,
        switchToHttp: (): object => ({
          getRequest: (): object => ({ user: { _id: 'u', roles: [role] } }),
        }),
      }) as unknown as ExecutionContext

    expect(guard.canActivate(contextFor('landlord'))).toBe(true)
    expect(() => guard.canActivate(contextFor('tenant'))).toThrow(
      ForbiddenException
    )
  })
})
