import 'reflect-metadata'
import { Controller, Get, Post } from '@nestjs/common'
import { Roles } from '../../common/decorators/roles.decorator'
import { BookingsController } from '../bookings/controllers/bookings.controller'
import { KycController } from '../users/controllers/kyc.controller'
import { WalletController } from '../wallets/controllers/wallet.controller'
import { buildPermissionSchema } from './permission-schema'
import { RequirePermission } from './decorators/require-permission.decorator'

@Controller('a')
class RolesFromMethod {
  @Get('x')
  @Roles('tenant', 'admin')
  @RequirePermission('read', 'Booking')
  one(): void {}

  @Post('y')
  @Roles('landlord', 'staff')
  @RequirePermission('create', 'Booking')
  @RequirePermission('update', 'Booking')
  two(): void {}

  @Get('z')
  plain(): void {}
}

@Roles('staff', 'admin')
@Controller('b')
class RolesFromClass {
  @Get('q')
  @RequirePermission('approve', 'Kyc')
  approve(): void {}
}

@Controller('c')
class NoRoles {
  @Get('with-audience')
  @RequirePermission('read', 'Wallet', ['landlord'])
  scoped(): void {}

  @Get('everyone')
  @RequirePermission('read', 'Apartment')
  everyone(): void {}
}

const rows = (
  schema: ReturnType<typeof buildPermissionSchema>,
  role: 'tenant' | 'landlord' | 'staff'
): Record<string, string[]> =>
  Object.fromEntries(schema[role].map(r => [r.subject, r.actions]))

describe('buildPermissionSchema', () => {
  it('takes the audience of a route from its @Roles and ignores admin', () => {
    const schema = buildPermissionSchema([RolesFromMethod])
    expect(rows(schema, 'tenant')).toEqual({ Booking: ['read'] })
    expect(rows(schema, 'landlord')).toEqual({ Booking: ['create'] })
    expect(rows(schema, 'staff')).toEqual({ Booking: ['create'] })
  })

  it('falls back to the controller @Roles', () => {
    const schema = buildPermissionSchema([RolesFromClass])
    expect(rows(schema, 'staff')).toEqual({ Kyc: ['approve'] })
    expect(rows(schema, 'tenant')).toEqual({})
    expect(rows(schema, 'landlord')).toEqual({})
  })

  it('uses the declared audience, else every managed role, when there is no @Roles', () => {
    const schema = buildPermissionSchema([NoRoles])
    expect(rows(schema, 'landlord')).toEqual({
      Wallet: ['read'],
      Apartment: ['read'],
    })
    expect(rows(schema, 'tenant')).toEqual({ Apartment: ['read'] })
    expect(rows(schema, 'staff')).toEqual({ Apartment: ['read'] })
  })

  it('ignores routes without @RequirePermission and merges repeated subjects in a fixed order', () => {
    const schema = buildPermissionSchema([RolesFromMethod, RolesFromClass])
    expect(schema.staff.map(r => r.subject)).toEqual(['Kyc', 'Booking'])
    expect(
      Object.values(schema)
        .flat()
        .every(row => row.actions.length > 0)
    ).toBe(true)
  })

  it('orders actions as read, create, update, delete, approve', () => {
    @Controller('d')
    class Mixed {
      @Get('1')
      @RequirePermission('approve', 'Apartment', ['staff'])
      a(): void {}
      @Get('2')
      @RequirePermission('delete', 'Apartment', ['staff'])
      b(): void {}
      @Get('3')
      @RequirePermission('read', 'Apartment', ['staff'])
      c(): void {}
      @Get('4')
      @RequirePermission('create', 'Apartment', ['staff'])
      d(): void {}
    }
    expect(rows(buildPermissionSchema([Mixed]), 'staff')).toEqual({
      Apartment: ['read', 'create', 'delete', 'approve'],
    })
  })
})

describe('permission schema of the real controllers', () => {
  const schema = buildPermissionSchema([
    BookingsController,
    KycController,
    WalletController,
  ])

  it('shows tenants the booking actions and not staff-only ones', () => {
    expect(rows(schema, 'tenant').Booking).toEqual(['read', 'create', 'update'])
    expect(rows(schema, 'tenant').Kyc).not.toContain('approve')
  })

  it('shows landlords their wallet and booking approvals', () => {
    expect(rows(schema, 'landlord').Wallet).toEqual(['read', 'create'])
    expect(rows(schema, 'landlord').Booking).toContain('approve')
  })

  it('shows staff the KYC review but not the wallet', () => {
    expect(rows(schema, 'staff').Kyc).toContain('approve')
    expect(rows(schema, 'staff').Wallet).toBeUndefined()
  })
})
