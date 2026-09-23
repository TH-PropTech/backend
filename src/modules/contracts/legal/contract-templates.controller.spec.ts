import { ROLES_KEY } from '../../../common/decorators/roles.decorator'
import type { ContractTemplateGovernanceService } from './contract-template-governance.service'
import { ContractTemplatesController } from './contract-templates.controller'

describe('ContractTemplatesController', () => {
  const service = {
    getPublishedVersion: jest.fn(),
    getAuditHistory: jest.fn(),
    saveDraft: jest.fn(),
    validateDraft: jest.fn(),
    publishDraft: jest.fn(),
  }
  const controller = new ContractTemplatesController(
    service as unknown as ContractTemplateGovernanceService
  )

  beforeEach(() => jest.clearAllMocks())

  it('delegates staff reads and admin mutations with actor/revision context', async () => {
    service.getPublishedVersion.mockResolvedValue({ version: 2 })
    service.getAuditHistory.mockResolvedValue([])
    service.saveDraft.mockResolvedValue({ version: 0 })
    service.validateDraft.mockResolvedValue({ valid: true })
    service.publishDraft.mockResolvedValue({ version: 2 })

    await controller.getPublished('template-1')
    await controller.getPublishedVersion('template-1', 2)
    await controller.getAuditHistory('template-1')
    await controller.saveDraft(
      'template-1',
      {
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
        clauses: [],
        allowedVariables: [],
        addenda: [],
        citationIds: [],
        expectedRevision: 3,
      },
      'admin-1'
    )
    await controller.validateDraft('template-1')
    await controller.publishDraft(
      'template-1',
      { reason: 'legal review' },
      'admin-1'
    )

    expect(service.getPublishedVersion).toHaveBeenNthCalledWith(1, 'template-1')
    expect(service.getPublishedVersion).toHaveBeenNthCalledWith(
      2,
      'template-1',
      2
    )
    expect(service.saveDraft).toHaveBeenCalledWith(
      'template-1',
      expect.objectContaining({ expectedRevision: 3 }),
      'admin-1',
      3
    )
    expect(service.publishDraft).toHaveBeenCalledWith(
      'template-1',
      'admin-1',
      'legal review'
    )
  })

  it('keeps staff read access separate from admin-only mutation routes', () => {
    const prototype = ContractTemplatesController.prototype
    const rolesFor = (methodName: string): unknown => {
      const method = Object.getOwnPropertyDescriptor(prototype, methodName)
        ?.value as object | undefined
      return method ? Reflect.getMetadata(ROLES_KEY, method) : undefined
    }
    expect(rolesFor('getPublished')).toEqual(['admin', 'staff'])
    expect(rolesFor('getAuditHistory')).toEqual(['admin', 'staff'])
    expect(rolesFor('saveDraft')).toEqual(['admin'])
    expect(rolesFor('validateDraft')).toEqual(['admin'])
    expect(rolesFor('publishDraft')).toEqual(['admin'])
  })
})
