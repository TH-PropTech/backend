import { ROLES_KEY } from '../../common/decorators/roles.decorator'
import { ContractCommercialEditorController } from './contract-commercial-editor.controller'
import type { ContractCommercialEditorService } from './contract-commercial-editor.service'

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

describe('ContractCommercialEditorController', () => {
  it('delegates editor operations with the server-side admin boundary', async () => {
    const service = {
      getEditor: jest.fn().mockResolvedValue({ revision: 1 }),
      validateDraft: jest.fn().mockResolvedValue({ valid: true }),
      saveDraft: jest.fn().mockResolvedValue({ revision: 2 }),
    }
    const controller = new ContractCommercialEditorController(
      service as unknown as ContractCommercialEditorService
    )
    const user = { _id: 'admin-1' } as never
    const commercial = {
      monthlyRent: 15_000_000,
      deposit: 30_000_000,
      paymentDay: 5,
      latePenaltyRate: 8,
      terminationNoticeDays: 30,
      durationMonths: 12,
    }

    await controller.getEditor('contract-1', user)
    await controller.validate('contract-1', { commercial }, 'admin-1')
    await controller.save(
      'contract-1',
      { commercial, expectedRevision: 1 },
      'admin-1'
    )

    expect(service.getEditor).toHaveBeenCalledWith(
      'contract-1',
      'admin-1',
      true
    )
    expect(service.validateDraft).toHaveBeenCalledWith(
      'contract-1',
      commercial,
      'admin-1',
      true
    )
    expect(service.saveDraft).toHaveBeenCalledWith(
      'contract-1',
      commercial,
      1,
      'admin-1',
      true
    )
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        getMethodTarget(
          ContractCommercialEditorController.prototype,
          'getEditor'
        )
      )
    ).toEqual(['admin'])
  })
})
