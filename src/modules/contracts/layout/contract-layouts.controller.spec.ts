import type { ContractLayoutService } from './contract-layout.service'
import { ContractLayoutsController } from './contract-layouts.controller'

describe('ContractLayoutsController', () => {
  it('delegates draft, preview, publish, and archive with actor context', async () => {
    const service = {
      saveDraft: jest.fn().mockResolvedValue({}),
      validateDraft: jest.fn().mockResolvedValue({ valid: true }),
      previewDraft: jest.fn().mockResolvedValue({}),
      publishDraft: jest.fn().mockResolvedValue({}),
      archive: jest.fn().mockResolvedValue({}),
    }
    const controller = new ContractLayoutsController(
      service as unknown as ContractLayoutService
    )
    const draft = {
      legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE' as const,
      blocks: [],
      supplementaryClauses: [],
      expectedRevision: 0,
    }

    await controller.saveDraft('standard', draft, 'admin-1')
    await controller.validateDraft('standard')
    await controller.previewDraft('standard')
    await controller.publishDraft('standard', { reason: 'reviewed' }, 'admin-1')
    await controller.archive(
      'standard',
      { version: 1, reason: 'retired' },
      'admin-1'
    )

    expect(service.saveDraft).toHaveBeenCalledWith(
      'standard',
      draft,
      'admin-1',
      0
    )
    expect(service.publishDraft).toHaveBeenCalledWith(
      'standard',
      'admin-1',
      'reviewed'
    )
    expect(service.archive).toHaveBeenCalledWith(
      'standard',
      1,
      'admin-1',
      'retired'
    )
  })
})
