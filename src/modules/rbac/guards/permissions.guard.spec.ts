import 'reflect-metadata'
import { ForbiddenException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { REQUIRE_PERMISSION_KEY } from '../rbac.constants'
import { PermissionsGuard } from './permissions.guard'

class Probe {
  @SetMetadata(REQUIRE_PERMISSION_KEY, { action: 'approve', subject: 'Kyc' })
  guarded(this: void): void {}

  open(this: void): void {}
}

function contextFor(
  handler: () => void,
  user: { roles?: string[] } | undefined
): never {
  return {
    getHandler: () => handler,
    getClass: () => Probe,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never
}

function setup(roleCan: boolean): {
  guard: PermissionsGuard
  rbac: { roleCan: ReturnType<typeof jest.fn> }
} {
  const rbac = { roleCan: jest.fn().mockResolvedValue(roleCan) }
  return { guard: new PermissionsGuard(new Reflector(), rbac as never), rbac }
}

describe('PermissionsGuard', () => {
  it('lets a route without a requirement through', async () => {
    const { guard, rbac } = setup(false)
    await expect(
      guard.canActivate(contextFor(Probe.prototype.open, { roles: ['staff'] }))
    ).resolves.toBe(true)
    expect(rbac.roleCan).not.toHaveBeenCalled()
  })

  it('always lets admin through without consulting the policy', async () => {
    const { guard, rbac } = setup(false)
    await expect(
      guard.canActivate(
        contextFor(Probe.prototype.guarded, { roles: ['admin'] })
      )
    ).resolves.toBe(true)
    expect(rbac.roleCan).not.toHaveBeenCalled()
  })

  it('applies the matrix to landlords and tenants too, using their own roles', async () => {
    const { guard, rbac } = setup(true)
    for (const role of ['landlord', 'tenant']) {
      await expect(
        guard.canActivate(
          contextFor(Probe.prototype.guarded, { roles: [role] })
        )
      ).resolves.toBe(true)
      expect(rbac.roleCan).toHaveBeenLastCalledWith(
        [role],
        'approve',
        'Kyc',
        undefined
      )
    }
  })

  it('blocks a landlord whose role has the switch off', async () => {
    const { guard } = setup(false)
    await expect(
      guard.canActivate(
        contextFor(Probe.prototype.guarded, { roles: ['landlord'] })
      )
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('lets staff through when the permission is on', async () => {
    const { guard, rbac } = setup(true)
    await expect(
      guard.canActivate(
        contextFor(Probe.prototype.guarded, { roles: ['staff'] })
      )
    ).resolves.toBe(true)
    expect(rbac.roleCan).toHaveBeenCalledWith(
      ['staff'],
      'approve',
      'Kyc',
      undefined
    )
  })

  it('blocks staff with a stable code and a Vietnamese message when it is off', async () => {
    const { guard } = setup(false)
    const result = guard.canActivate(
      contextFor(Probe.prototype.guarded, { roles: ['STAFF'] })
    )
    await expect(result).rejects.toBeInstanceOf(ForbiddenException)
    await expect(result).rejects.toMatchObject({
      response: {
        code: 'PERMISSION_DENIED',
        message:
          'Bạn chưa được cấp quyền duyệt xác minh KYC. Vui lòng liên hệ quản trị viên.',
      },
    })
  })

  it('lets an anonymous request through on a public route (no role to apply)', async () => {
    const { guard, rbac } = setup(false)
    await expect(
      guard.canActivate(contextFor(Probe.prototype.guarded, undefined))
    ).resolves.toBe(true)
    expect(rbac.roleCan).not.toHaveBeenCalled()
  })
})
