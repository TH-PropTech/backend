import { PoliciesController } from './policies.controller'
import type { PoliciesService } from '../services/policies.service'
import type { UserPayload } from '../../auth/interfaces/auth.interface'

describe('PoliciesController', () => {
  let controller: PoliciesController
  let service: {
    findPublicPolicies: jest.Mock
    findAdminPolicies: jest.Mock
    findOne: jest.Mock
    update: jest.Mock
    updateStatus: jest.Mock
  }

  beforeEach(() => {
    service = {
      findPublicPolicies: jest.fn(),
      findAdminPolicies: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      updateStatus: jest.fn(),
    }

    controller = new PoliciesController(service as unknown as PoliciesService)
  })

  it('getPublicPolicies returns public projection', async () => {
    service.findPublicPolicies.mockResolvedValue([
      { key: 'P1', value: '10', description: 'Desc 1' },
    ])

    const res = await controller.getPublicPolicies()
    expect(res).toHaveLength(1)
    expect(service.findPublicPolicies).toHaveBeenCalled()
  })

  it('getAdminPolicies delegates to findAdminPolicies', async () => {
    service.findAdminPolicies.mockResolvedValue([
      { key: 'P1', value: '10', description: 'Desc 1', status: 'active' },
    ])

    const res = await controller.getAdminPolicies()
    expect(res).toHaveLength(1)
    expect(service.findAdminPolicies).toHaveBeenCalled()
  })

  it('updatePolicy passes user id to service', async () => {
    service.update.mockResolvedValue({ key: 'P1', value: '20' })
    const user: UserPayload = {
      _id: 'admin-id',
      email: 'admin@proptech.vn',
      roles: ['admin'],
    }

    const res = await controller.updatePolicy('P1', { value: '20' }, user)
    expect(res.value).toBe('20')
    expect(service.update).toHaveBeenCalledWith('P1', '20', 'admin-id')
  })

  it('updatePolicyStatus passes user id to service', async () => {
    service.updateStatus.mockResolvedValue({ key: 'P1', status: 'inactive' })
    const user: UserPayload = {
      _id: 'admin-id',
      email: 'admin@proptech.vn',
      roles: ['admin'],
    }

    const res = await controller.updatePolicyStatus(
      'P1',
      { status: 'inactive' },
      user
    )
    expect(res.status).toBe('inactive')
    expect(service.updateStatus).toHaveBeenCalledWith(
      'P1',
      'inactive',
      'admin-id'
    )
  })
})
