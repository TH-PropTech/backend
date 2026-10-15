import type { ActivityLog } from '../../activity-log/schemas/activity-log.schema'
import type { Repository } from 'typeorm'
import { ObjectId } from 'mongodb'
import { ConfigAuditService } from '../../activity-log/services/config-audit.service'
import type { ConfigAudit } from '../../activity-log/schemas/config-audit.schema'
import type { ContractLayoutProfile } from '../schemas/contract-layout-profile.schema'
import {
  ContractTemplate,
  type ContractTemplateEntityKind,
} from '../schemas/contract-template.schema'
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

type Row = Record<string, unknown> & { _id: ObjectId }

/**
 * Fake repository của `contract_templates` (mô phỏng TypeORM Mongo):
 * lọc đúng `where` (kể cả `$in` có null), `save` theo `_id` (đã có thì ghi đè),
 * `remove` theo `_id`. Dùng fixture trộn kind để kiểm điều kiện `kind`.
 */
class FakeTemplateRepository {
  rows: Row[] = []

  private matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([key, expected]) => {
      const actual = row[key] ?? null
      if (expected && typeof expected === 'object' && '$in' in expected) {
        return (expected as { $in: unknown[] }).$in.includes(actual)
      }
      return actual === expected
    })
  }

  private sorted(rows: Row[], order?: Record<string, 'ASC' | 'DESC'>): Row[] {
    if (!order?.version) return rows
    const dir = order.version === 'DESC' ? -1 : 1
    return [...rows].sort(
      (a, b) => (Number(a.version) - Number(b.version)) * dir
    )
  }

  findOne({
    where,
    order,
  }: {
    where: Record<string, unknown>
    order?: Record<string, 'ASC' | 'DESC'>
  }): Promise<ContractTemplate | null> {
    const found = this.sorted(
      this.rows.filter(row => this.matches(row, where)),
      order
    )[0]
    return Promise.resolve((found ?? null) as ContractTemplate | null)
  }

  find({
    where,
    order,
  }: {
    where?: Record<string, unknown>
    order?: Record<string, 'ASC' | 'DESC'>
  } = {}): Promise<ContractTemplate[]> {
    return Promise.resolve(
      this.sorted(
        this.rows.filter(row => this.matches(row, where)),
        order
      ) as unknown as ContractTemplate[]
    )
  }

  create(value: Partial<ContractTemplate>): ContractTemplate {
    return Object.assign(new ContractTemplate(), value)
  }

  save(value: ContractTemplate): Promise<ContractTemplate> {
    const row = value as unknown as Row
    if (!row._id) row._id = new ObjectId()
    const index = this.rows.findIndex(r => r._id.equals(row._id))
    if (index >= 0) this.rows[index] = row
    else this.rows.push(row)
    return Promise.resolve(value)
  }

  remove(value: ContractTemplate): Promise<ContractTemplate> {
    const id = (value as unknown as Row)._id
    this.rows = this.rows.filter(r => !r._id.equals(id))
    return Promise.resolve(value)
  }
}

function asRepository(
  fake: FakeTemplateRepository
): Repository<ContractTemplate> {
  return fake as unknown as Repository<ContractTemplate>
}

function templateRow(
  overrides: Partial<Record<string, unknown>> & {
    kind?: ContractTemplateEntityKind | null
  } = {}
): Row {
  const { kind, ...rest } = overrides
  const row: Row = {
    _id: new ObjectId(),
    templateKey: 'standard',
    version: 1,
    status: 'published',
    legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
    clauses: [],
    allowedVariables: [],
    addenda: [],
    citationIds: [],
    contentHash: 'template-hash',
    draftRevision: 1,
    createdBy: 'seed',
    ...rest,
  }
  if (kind !== null) row.kind = kind ?? 'template'
  return row
}

function layoutRow(overrides: Record<string, unknown> = {}): Row {
  return {
    _id: new ObjectId(),
    kind: 'layout',
    profileKey: 'standard',
    templateKey: null,
    version: 1,
    status: 'published',
    legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
    blocks: [],
    supplementaryClauses: [],
    disclosures: [],
    contentHash: 'layout-hash',
    draftRevision: 1,
    createdBy: 'admin',
    ...overrides,
  }
}

function buildService(fake: FakeTemplateRepository): ContractLayoutService {
  const audits = {
    create: jest.fn((value: Partial<ConfigAudit>) => value),
    save: jest.fn().mockResolvedValue({}),
  }
  return new ContractLayoutService(
    asRepository(fake),
    new ConfigAuditService(audits as unknown as Repository<ActivityLog>)
  )
}

describe('ContractLayoutService', () => {
  it('previews without persistence and publishes an immutable revision', async () => {
    const fake = new FakeTemplateRepository()
    const save = jest.spyOn(fake, 'save')
    const remove = jest.spyOn(fake, 'remove')
    const audits = {
      create: jest.fn((value: Partial<ConfigAudit>) => value),
      save: jest.fn().mockResolvedValue({}),
    }
    const service = new ContractLayoutService(
      asRepository(fake),
      new ConfigAuditService(audits as unknown as Repository<ActivityLog>)
    )

    const saved = await service.saveDraft('standard', input, 'admin-1', 0)
    const savesAfterDraft = save.mock.calls.length
    const preview = await service.previewDraft('standard')
    const published = await service.publishDraft(
      'standard',
      'admin-1',
      'reviewed'
    )

    expect(saved.supplementaryClauses[0]?.content).toBe('safe')
    expect(preview.contentHash).toBe(saved.contentHash)
    expect(save).toHaveBeenCalledTimes(savesAfterDraft + 1)
    expect(published).toEqual(
      expect.objectContaining({ version: 1, status: 'published' })
    )
    // Bản published là dòng MỚI: không mang _id của draft, draft bị xóa, published còn lại.
    expect(remove).toHaveBeenCalledTimes(1)
    expect(fake.rows).toHaveLength(1)
    expect(fake.rows[0]).toEqual(
      expect.objectContaining({
        kind: 'layout',
        status: 'published',
        version: 1,
      })
    )
    // Kiểm toán ghi vào activity_logs với kind 'config-audit' (facade ConfigAuditService).
    expect(audits.save).toHaveBeenCalledTimes(2)
    expect(audits.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'config-audit',
        scope: 'contract-layout',
        key: 'standard',
        action: 'draft-created',
        actorId: 'admin-1',
        afterHash: saved.contentHash,
      })
    )
    expect(audits.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        kind: 'config-audit',
        scope: 'contract-layout',
        key: 'standard',
        version: 1,
        action: 'published',
        actorId: 'admin-1',
        reason: 'reviewed',
        afterHash: saved.contentHash,
      })
    )
  })

  it('never returns the kind field and ignores template rows with the same key', async () => {
    const fake = new FakeTemplateRepository()
    // Mẫu hợp đồng trùng khóa và trùng trạng thái: không được bị coi là layout.
    fake.rows.push(templateRow({ templateKey: 'standard', status: 'draft' }))
    fake.rows.push(
      templateRow({ templateKey: 'standard', status: 'published' })
    )
    const service = buildService(fake)

    const draft = await service.saveDraft('standard', input, 'admin-1', 0)

    expect(draft).not.toHaveProperty('kind')
    expect(draft.profileKey).toBe('standard')
    expect(fake.rows.filter(r => r.kind === 'layout')).toHaveLength(1)
    await expect(service.previewDraft('standard')).resolves.not.toHaveProperty(
      'kind'
    )
  })

  it('accepts legacy template rows without kind as templates, not layouts', async () => {
    const fake = new FakeTemplateRepository()
    fake.rows.push(templateRow({ kind: null, status: 'draft', version: 0 }))
    const service = buildService(fake)

    await expect(service.previewDraft('standard')).rejects.toThrow(
      'CONTRACT_LAYOUT_DRAFT_NOT_FOUND'
    )
  })
})

describe('ContractLayoutService.listLatestPublished (PROP-399 governance source)', () => {
  it('returns only the highest published layout per profileKey, ordered by key, without kind', async () => {
    const fake = new FakeTemplateRepository()
    fake.rows.push(
      layoutRow({ profileKey: 'standard', version: 1 }),
      layoutRow({ profileKey: 'compact', version: 2 }),
      layoutRow({ profileKey: 'standard', version: 4 }),
      // Template đã published cùng trạng thái: không được lọt vào danh sách layout.
      templateRow({ templateKey: 'zzz', version: 9, status: 'published' })
    )
    const service = buildService(fake)

    const latest = (await service.listLatestPublished()) as Array<
      ContractLayoutProfile & { kind?: string }
    >

    expect(latest.map(p => `${p.profileKey}@${p.version}`)).toEqual([
      'compact@2',
      'standard@4',
    ])
    expect(latest.every(p => !('kind' in p))).toBe(true)
  })
})

describe('ContractLayoutService.findPublishedForContract', () => {
  it('prefers the template-specific layout, else the shared layout, ignoring template rows', async () => {
    const fake = new FakeTemplateRepository()
    fake.rows.push(
      layoutRow({ profileKey: 'shared', templateKey: null, version: 1 }),
      layoutRow({ profileKey: 'specific', templateKey: 'T1', version: 1 }),
      // Template cùng legalProfile và templateKey 'T1' phải bị bỏ qua.
      templateRow({
        templateKey: 'T1',
        legalProfile: 'PRIVATE_CIVIL_APARTMENT_LEASE',
      })
    )
    const service = buildService(fake)

    const specific = await service.findPublishedForContract(
      'PRIVATE_CIVIL_APARTMENT_LEASE',
      'T1'
    )
    const shared = await service.findPublishedForContract(
      'PRIVATE_CIVIL_APARTMENT_LEASE',
      'T9'
    )

    expect(specific?.profileKey).toBe('specific')
    expect(shared?.profileKey).toBe('shared')
    expect(specific).not.toHaveProperty('kind')
  })
})
