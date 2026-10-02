import type { Repository } from 'typeorm'
import { ContractLayoutAudit } from './contract-layout-audit.schema'
import { ContractLayoutProfile } from './contract-layout-profile.schema'
import { ContractLayoutService } from './contract-layout.service'

const input = {
  legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE' as const,
  blocks: [
    { blockId: 'PARTIES' as const, order: 1, title: 'Parties', visible: true },
    {
      blockId: 'PROPERTY' as const,
      order: 2,
      title: 'Property',
      visible: true,
    },
    {
      blockId: 'COMMERCIAL_TERMS' as const,
      order: 3,
      title: 'Terms',
      visible: true,
    },
    {
      blockId: 'LEGAL_ARTICLES' as const,
      order: 4,
      title: 'Articles',
      visible: true,
    },
    { blockId: 'SIGNATURES' as const, order: 5, title: 'Sign', visible: true },
  ],
  supplementaryClauses: [
    {
      id: 'extra',
      title: 'Extra',
      content: '<script>x</script>safe',
      enabled: true,
    },
  ],
}

describe('ContractLayoutService', () => {
  it('previews without persistence and publishes an immutable revision', async () => {
    let draft: ContractLayoutProfile | null = null
    const profiles = {
      findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.status === 'draft' ? draft : null)
      ),
      create: jest.fn((value: Partial<ContractLayoutProfile>) =>
        Object.assign(new ContractLayoutProfile(), value)
      ),
      save: jest.fn((value: ContractLayoutProfile) => {
        if (value.status === 'draft') draft = value
        return Promise.resolve(value)
      }),
      remove: jest.fn((value: ContractLayoutProfile) => {
        if (value === draft) draft = null
        return Promise.resolve(value)
      }),
    }
    const audits = {
      create: jest.fn((value: Partial<ContractLayoutAudit>) => value),
      save: jest.fn().mockResolvedValue({}),
    }
    const service = new ContractLayoutService(
      profiles as unknown as Repository<ContractLayoutProfile>,
      audits as unknown as Repository<ContractLayoutAudit>
    )

    const saved = await service.saveDraft('standard', input, 'admin-1', 0)
    const savesAfterDraft = profiles.save.mock.calls.length
    const preview = await service.previewDraft('standard')
    const published = await service.publishDraft(
      'standard',
      'admin-1',
      'reviewed'
    )

    expect(saved.supplementaryClauses[0]?.content).toBe('safe')
    expect(preview.contentHash).toBe(saved.contentHash)
    expect(profiles.save).toHaveBeenCalledTimes(savesAfterDraft + 1)
    expect(published).toEqual(
      expect.objectContaining({ version: 1, status: 'published' })
    )
    expect(profiles.remove).toHaveBeenCalledWith(saved)
  })
})
