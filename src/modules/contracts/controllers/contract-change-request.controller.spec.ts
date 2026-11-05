import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { ContractChangeRequestController } from './contract-change-request.controller'

function rolesOf(method: keyof ContractChangeRequestController): string[] {
  return Reflect.getMetadata(
    ROLES_KEY,
    ContractChangeRequestController.prototype[method]
  ) as string[]
}

describe('ContractChangeRequestController roles', () => {
  it('lets only participants create and accept', () => {
    expect(rolesOf('create')).toEqual(['landlord', 'tenant'])
    expect(rolesOf('accept')).toEqual(['landlord', 'tenant'])
  })

  it('lets admin and staff read, reject and cancel but not accept', () => {
    for (const method of ['list', 'reject', 'cancel'] as const) {
      expect(rolesOf(method)).toEqual(
        expect.arrayContaining(['admin', 'staff'])
      )
    }
    expect(rolesOf('accept')).not.toContain('admin')
    expect(rolesOf('accept')).not.toContain('staff')
  })
})
