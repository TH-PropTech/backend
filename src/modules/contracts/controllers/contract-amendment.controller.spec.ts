import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import { ContractAmendmentController } from './contract-amendment.controller'
import type { ContractAmendmentService } from '../services/contract-amendment.service'

function getMethodTarget(prototype: object, methodName: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName)
  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`Missing method descriptor: ${methodName}`)
  }
  const method: unknown = descriptor.value
  if (typeof method !== 'function') {
    throw new Error(`Invalid method descriptor: ${methodName}`)
  }
  return method
}

describe('ContractAmendmentController', () => {
  it('opens create to participants, keeps lock and artifact staff-only and delegates participant signing context', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ sequence: 1 }),
      sign: jest.fn().mockResolvedValue({ status: 'effective' }),
      resolveParticipantRole: jest.fn().mockResolvedValue('tenant'),
    }
    const controller = new ContractAmendmentController(
      service as unknown as ContractAmendmentService
    )
    const staff = { _id: 'staff-1', roles: ['staff'] } as never
    const tenant = { _id: 'tenant-1', roles: ['tenant'] } as never
    const dto = {
      changes: [{ field: 'monthlyRent', after: 17_000_000 }],
      effectiveFrom: '2030-01-01T00:00:00.000Z',
    }

    await controller.create('contract-1', dto, staff)
    await controller.sign(
      'contract-1',
      'amendment-1',
      { expectedRevision: 2, signatureHash: 'a'.repeat(64) },
      tenant
    )

    expect(service.create).toHaveBeenCalledWith(
      'contract-1',
      dto,
      expect.objectContaining({ actorId: 'staff-1', isStaff: true })
    )
    expect(service.sign).toHaveBeenCalledWith(
      'contract-1',
      'amendment-1',
      2,
      'a'.repeat(64),
      { actorId: 'tenant-1', isStaff: false, role: 'tenant' }
    )
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        getMethodTarget(ContractAmendmentController.prototype, 'create')
      )
    ).toEqual(['admin', 'staff', 'landlord', 'tenant'])
    for (const method of [
      'lock',
      'lockArtifact',
      'cancel',
      'update',
    ] as const) {
      const target = getMethodTarget(
        ContractAmendmentController.prototype,
        method
      )
      expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual(['admin', 'staff'])
    }
  })

  it('resolves landlord signing from the contract relationship when JWT has both roles', async () => {
    const service = {
      resolveParticipantRole: jest.fn().mockResolvedValue('landlord'),
      sign: jest.fn().mockResolvedValue({ status: 'effective' }),
    }
    const controller = new ContractAmendmentController(
      service as unknown as ContractAmendmentService
    )
    const landlord = {
      _id: 'landlord-1',
      roles: ['tenant', 'landlord'],
    } as never

    await controller.sign(
      'contract-1',
      'amendment-1',
      { expectedRevision: 2, signatureHash: 'a'.repeat(64) },
      landlord
    )

    expect(service.resolveParticipantRole).toHaveBeenCalledWith(
      'contract-1',
      'landlord-1'
    )
    expect(service.sign).toHaveBeenCalledWith(
      'contract-1',
      'amendment-1',
      2,
      'a'.repeat(64),
      { actorId: 'landlord-1', isStaff: false, role: 'landlord' }
    )
  })

  it('adds private no-cache metadata to amendment artifact downloads', async () => {
    const service = {
      resolveArtifact: jest.fn().mockResolvedValue({
        bytes: Buffer.from('%PDF-1.7\nartifact'),
        artifactHash: 'b'.repeat(64),
        revision: 3,
      }),
    }
    const controller = new ContractAmendmentController(
      service as unknown as ContractAmendmentService
    )
    const headers: Record<string, string> = {}
    const end = jest.fn()
    const response = {
      setHeader: (key: string, value: string) => {
        headers[key] = value
      },
      status: jest.fn().mockReturnThis(),
      end,
    } as never

    await expect(
      controller.downloadArtifact(
        'contract-1',
        'amendment-1',
        { _id: 'tenant-1', roles: ['tenant'] },
        response
      )
    ).resolves.toBeUndefined()
    expect(end).toHaveBeenCalledWith(Buffer.from('%PDF-1.7\nartifact'))
    expect(headers['Cache-Control']).toBe('private, no-store')
    expect(headers['X-Contract-Amendment-Artifact-Hash']).toBe('b'.repeat(64))
  })
})
