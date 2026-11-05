import { ConflictException, NotFoundException } from '@nestjs/common'
import type { Repository } from 'typeorm'
import { HandoverTemplateService } from './handover-template.service'
import type { RentalFlowConfig } from '../schemas/rental-flow-config.schema'
import type { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import {
  computeHandoverTemplateHash,
  DEFAULT_HANDOVER_TEMPLATE,
  MOVE_IN_HANDOVER_TEMPLATE_KEY,
} from '../utils/handover-template.util'

describe('HandoverTemplateService', () => {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((value: RentalFlowConfig) => value),
    save: jest.fn((value: RentalFlowConfig) => Promise.resolve(value)),
    remove: jest.fn((value: RentalFlowConfig) => Promise.resolve(value)),
  }
  const audit = { append: jest.fn() }
  const service = new HandoverTemplateService(
    repo as unknown as Repository<RentalFlowConfig>,
    audit as unknown as ConfigAuditService
  )
  const content = {
    inventoryDefaults: [{ name: ' Tủ lạnh ', quantity: 1 }],
    checklist: [{ id: 'keys-handed', label: ' Đã giao chìa khóa ' }],
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('seeds the default template as v1 when none is published', async () => {
    repo.findOne.mockResolvedValue(null)

    await service.onModuleInit()

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'handover-template',
        key: MOVE_IN_HANDOVER_TEMPLATE_KEY,
        version: 1,
        status: 'published',
        handoverTemplate: DEFAULT_HANDOVER_TEMPLATE,
        contentHash: computeHandoverTemplateHash(DEFAULT_HANDOVER_TEMPLATE, 1),
      })
    )
  })

  it('does not seed again when a published version exists', async () => {
    repo.findOne.mockResolvedValue({ version: 3, status: 'published' })

    await service.onModuleInit()

    expect(repo.save).not.toHaveBeenCalled()
  })

  it('creates a normalized draft when none exists', async () => {
    repo.findOne.mockResolvedValue(null)

    const draft = await service.saveDraft(
      { expectedRevision: 1, ...content },
      'admin-1'
    )

    expect(draft.status).toBe('draft')
    expect(draft.inventoryDefaults).toEqual([{ name: 'Tủ lạnh', quantity: 1 }])
    expect(draft.checklist).toEqual([
      { id: 'keys-handed', label: 'Đã giao chìa khóa' },
    ])
  })

  it('rejects a stale draft revision', async () => {
    repo.findOne.mockResolvedValue({ status: 'draft', draftRevision: 3 })

    await expect(
      service.saveDraft({ expectedRevision: 2, ...content }, 'admin-1')
    ).rejects.toThrow(ConflictException)
  })

  it('refuses to publish without a draft', async () => {
    repo.findOne.mockResolvedValue(null)

    await expect(
      service.publish({ expectedRevision: 1, reason: 'x' }, 'admin-1')
    ).rejects.toThrow(NotFoundException)
  })

  it('publishes the next version, hashes it and removes the draft', async () => {
    const draft = {
      status: 'draft',
      draftRevision: 2,
      handoverTemplate: content,
      createdBy: 'admin-1',
    }
    repo.findOne
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ version: 4, status: 'published' })

    const published = await service.publish(
      { expectedRevision: 2, reason: 'đổi checklist' },
      'admin-2'
    )

    expect(published.version).toBe(5)
    expect(published.contentHash).toBe(computeHandoverTemplateHash(content, 5))
    expect(repo.remove).toHaveBeenCalledWith(draft)
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'HANDOVER_TEMPLATE_PUBLISHED',
        version: 5,
      })
    )
  })
})
