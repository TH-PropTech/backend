import { ObjectId } from 'mongodb'
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import {
  FabricGovernanceService,
  GOVERNANCE_SECRET_KEY_PATTERNS,
  GOVERNANCE_SECRET_VALUE_PATTERNS,
} from './fabric-governance.service'
import { FabricGovernanceSnapshot } from './schemas/fabric-governance-snapshot.schema'
import {
  buildGovernanceEvidenceEnvelope,
  hashGovernanceEvidenceEnvelope,
} from './governance-evidence-envelope'
import { ContractTemplateGovernanceService } from '../contracts/legal/contract-template-governance.service'
import { ContractLayoutService } from '../contracts/layout/contract-layout.service'
import { POLICY_DEFINITIONS } from '../policies/policy-definitions'

const H = (c: string): string => c.repeat(64)

type Mocks = ReturnType<typeof setup>

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(
  overrides: {
    policies?: Array<Record<string, unknown>>
    layouts?: Array<Record<string, unknown>>
    fee?: Record<string, unknown> | null
    executionPolicies?: Array<Record<string, unknown>>
    templates?: Array<Record<string, unknown>>
    terms?: Record<string, unknown> | Error
  } = {}
) {
  const stored: FabricGovernanceSnapshot[] = []
  const repository = {
    find: jest.fn(
      (query?: {
        where?: { status?: string }
        order?: { version?: 'ASC' | 'DESC' }
        take?: number
      }): Promise<FabricGovernanceSnapshot[]> => {
        let rows = [...stored]
        if (query?.where?.status) {
          rows = rows.filter(r => r.status === query.where?.status)
        }
        rows.sort((a, b) => b.version - a.version)
        if (query?.take) rows = rows.slice(0, query.take)
        return Promise.resolve(rows)
      }
    ),
    findOne: jest.fn(
      (query: {
        where: { _id?: ObjectId }
      }): Promise<FabricGovernanceSnapshot | null> =>
        Promise.resolve(
          stored.find(r => r._id.equals(query.where._id as ObjectId)) ?? null
        )
    ),
    findAndCount: jest.fn(
      (query: {
        skip: number
        take: number
      }): Promise<[FabricGovernanceSnapshot[], number]> => {
        const rows = [...stored].sort((a, b) => b.version - a.version)
        return Promise.resolve([
          rows.slice(query.skip, query.skip + query.take),
          rows.length,
        ])
      }
    ),
    create: jest.fn(
      (value: Partial<FabricGovernanceSnapshot>): FabricGovernanceSnapshot =>
        Object.assign(new FabricGovernanceSnapshot(), value)
    ),
    save: jest.fn(
      (value: FabricGovernanceSnapshot): Promise<FabricGovernanceSnapshot> => {
        value._id ??= new ObjectId()
        stored.push(value)
        return Promise.resolve(value)
      }
    ),
  }
  const legalTerms = {
    getCurrentPublishedTerms: jest.fn(() =>
      overrides.terms instanceof Error
        ? Promise.reject(overrides.terms)
        : Promise.resolve(
            overrides.terms ?? {
              key: 'rental-service-terms',
              version: 2,
              contentHash: H('a'),
            }
          )
    ),
  }
  const policies = {
    findAll: jest.fn().mockResolvedValue(
      overrides.policies ?? [
        {
          key: 'MAX_DEPOSIT_LIMIT_PERCENT',
          value: '5',
          unit: '%',
          status: 'active',
        },
        {
          key: 'MIN_TERMINATION_NOTICE_DAYS',
          value: '30',
          unit: 'ngày',
          status: 'active',
        },
        { key: 'LEGACY_FLAG', value: '1', status: 'inactive' },
      ]
    ),
  }
  const platformFees = {
    getEffectiveSchedule: jest
      .fn()
      .mockResolvedValue(
        overrides.fee === undefined
          ? { scheduleId: 'fees', version: 3, contentHash: H('d') }
          : overrides.fee
      ),
  }
  const executionPolicies = {
    listActive: jest.fn().mockResolvedValue(
      overrides.executionPolicies ?? [
        { policyId: 'SIGN_FIRST', version: 1, contentHash: H('f') },
        { policyId: 'DEPOSIT_FIRST', version: 2, contentHash: H('e') },
      ]
    ),
  }
  const templateService = {
    listLatestPublished: jest.fn().mockResolvedValue(
      overrides.templates ?? [
        {
          templateKey: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
          version: 4,
          contentHash: H('b'),
        },
        {
          templateKey: 'VN_RE_BUSINESS_ND96_APPENDIX_II',
          version: 1,
          contentHash: H('c'),
        },
      ]
    ),
  }
  const layoutService = {
    listLatestPublished: jest
      .fn()
      .mockResolvedValue(
        overrides.layouts ?? [
          { profileKey: 'standard', version: 2, contentHash: H('1') },
        ]
      ),
  }
  const moduleRef = {
    get: jest.fn((token: unknown) => {
      if (token === ContractTemplateGovernanceService) return templateService
      if (token === ContractLayoutService) return layoutService
      throw new Error('unexpected token')
    }),
  }
  const outbox = {
    enqueue: jest.fn((input: Record<string, unknown>) =>
      Promise.resolve({ _id: new ObjectId(), ...input })
    ),
  }
  const fabric = {
    getStatus: jest.fn(() => ({ mode: 'fabric' })),
    evaluateTransaction: jest.fn(),
  }
  const service = new FabricGovernanceService(
    repository as never,
    legalTerms as never,
    policies as never,
    platformFees as never,
    executionPolicies as never,
    outbox as never,
    fabric as never,
    moduleRef as never
  )
  return {
    service,
    stored,
    repository,
    legalTerms,
    policies,
    platformFees,
    executionPolicies,
    templateService,
    layoutService,
    moduleRef,
    outbox,
    fabric,
  }
}

const ADMIN = { id: 'admin-1', role: 'admin' }

describe('FabricGovernanceService (PROP-399 tasks 4.1/4.2)', () => {
  describe('publish — source resolution', () => {
    it('resolves every component from its authoritative source module', async () => {
      const m = setup()
      const { snapshot, created } = await m.service.publish(ADMIN)

      expect(created).toBe(true)
      expect(snapshot.components.legalTerms).toEqual([
        { id: 'rental-service-terms', version: 2, hash: H('a') },
      ])
      expect(snapshot.components.contractTemplate).toEqual([
        {
          id: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
          version: 4,
          hash: H('b'),
        },
        { id: 'VN_RE_BUSINESS_ND96_APPENDIX_II', version: 1, hash: H('c') },
      ])
      expect(snapshot.components.contractLayout).toEqual([
        { id: 'standard', version: 2, hash: H('1') },
      ])
      expect(snapshot.components.rentalExecutionPolicy).toEqual([
        { policyId: 'DEPOSIT_FIRST', version: 2, hash: H('e') },
        { policyId: 'SIGN_FIRST', version: 1, hash: H('f') },
      ])
      expect(snapshot.components.feeSchedule).toEqual({
        id: 'fees',
        version: 3,
        hash: H('d'),
      })
      expect(m.executionPolicies.listActive).toHaveBeenCalledTimes(1)
      expect(m.platformFees.getEffectiveSchedule).toHaveBeenCalledTimes(1)
    })

    it('includes only ACTIVE policies, sorted by key, hashing key+value+unit', async () => {
      const m = setup()
      const { snapshot } = await m.service.publish(ADMIN)

      expect(snapshot.components.policySet.map(p => p.key)).toEqual([
        'MAX_DEPOSIT_LIMIT_PERCENT',
        'MIN_TERMINATION_NOTICE_DAYS',
      ])
      expect(snapshot.components.policySet[0]).toMatchObject({
        value: '5',
        unit: '%',
      })
      expect(snapshot.components.policySet[0]?.hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('allows a missing layout and fee schedule (nullable) but never a missing required source', async () => {
      const m = setup({ layouts: [], fee: null })
      const { snapshot } = await m.service.publish(ADMIN)
      expect(snapshot.components.contractLayout).toBeNull()
      expect(snapshot.components.feeSchedule).toBeNull()
    })

    it.each([
      ['legalTerms', { terms: new NotFoundException('none') }],
      [
        'policySet',
        { policies: [{ key: 'X', value: '1', status: 'inactive' }] },
      ],
      ['contractTemplate', { templates: [] }],
      ['rentalExecutionPolicy', { executionPolicies: [] }],
    ])(
      'rejects with GOVERNANCE_SNAPSHOT_INCOMPLETE naming the missing/inactive %s and enqueues nothing',
      async (component, override) => {
        const m = setup(override)
        const error = await m.service.publish(ADMIN).catch((e: unknown) => e)

        expect(error).toBeInstanceOf(UnprocessableEntityException)
        const body = (error as UnprocessableEntityException).getResponse() as {
          code: string
          missing: string[]
        }
        expect(body.code).toBe('GOVERNANCE_SNAPSHOT_INCOMPLETE')
        expect(body.missing).toContain(component)
        expect(m.repository.save).not.toHaveBeenCalled()
        expect(m.outbox.enqueue).not.toHaveBeenCalled()
      }
    )

    it('reports every missing component at once', async () => {
      const m = setup({ templates: [], executionPolicies: [] })
      const error = (await m.service
        .publish(ADMIN)
        .catch((e: unknown) => e)) as UnprocessableEntityException
      const body = error.getResponse() as { missing: string[] }
      expect(body.missing).toEqual(
        expect.arrayContaining(['contractTemplate', 'rentalExecutionPolicy'])
      )
    })

    it('rejects a source whose hash cannot be canonically hashed as incomplete', async () => {
      const m = setup({
        executionPolicies: [
          { policyId: 'SIGN_FIRST', version: 1, contentHash: 'not-a-hash' },
        ],
      })
      const error = (await m.service
        .publish(ADMIN)
        .catch((e: unknown) => e)) as UnprocessableEntityException
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect((error.getResponse() as { code: string }).code).toBe(
        'GOVERNANCE_SNAPSHOT_INCOMPLETE'
      )
      expect(m.repository.save).not.toHaveBeenCalled()
    })

    it('rejects a published execution policy without a version', async () => {
      const m = setup({
        executionPolicies: [
          { policyId: 'SIGN_FIRST', version: null, contentHash: H('f') },
        ],
      })
      await expect(m.service.publish(ADMIN)).rejects.toBeInstanceOf(
        UnprocessableEntityException
      )
    })
  })

  describe('publish — secret-classified input', () => {
    it.each([
      'JWT_SECRET',
      'smartca_client_secret',
      'DB_PASSWORD',
      'API_KEY',
      'apiKey',
      'VNPAY_HASH_TOKEN',
      'FABRIC_PRIVATE_KEY',
      'AWS_CREDENTIALS',
    ])('rejects a policy key that looks like a secret: %s', async key => {
      const m = setup({
        policies: [
          { key: 'MAX_DEPOSIT_LIMIT_PERCENT', value: '5', status: 'active' },
          { key, value: '12', status: 'active' },
        ],
      })
      const error = (await m.service
        .publish(ADMIN)
        .catch((e: unknown) => e)) as UnprocessableEntityException
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      const body = error.getResponse() as { code: string; policyKeys: string[] }
      expect(body.code).toBe('GOVERNANCE_SECRET_CLASSIFIED')
      expect(body.policyKeys).toEqual([key])
      expect(m.repository.save).not.toHaveBeenCalled()
      expect(m.outbox.enqueue).not.toHaveBeenCalled()
    })

    it.each([
      ['PEM private key', '-----BEGIN PRIVATE KEY-----\nabc'],
      ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl'],
      ['bearer token', 'Bearer abcdef0123456789'],
      ['credentialed URL', 'postgres://user:hunter2@db.internal/app'],
      ['long hex digest', 'a'.repeat(48)],
      ['long opaque token', 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWpr'],
      ['AWS access key id', 'AKIAABCDEFGHIJKLMNOP'],
      ['payment live key', 'sk_live_abc123'],
    ])(
      'rejects a policy value that looks like a secret (%s) without echoing it',
      async (_label, value) => {
        const m = setup({
          policies: [
            { key: 'MAX_DEPOSIT_LIMIT_PERCENT', value: '5', status: 'active' },
            { key: 'SOME_NOTE', value, status: 'active' },
          ],
        })
        const error = (await m.service
          .publish(ADMIN)
          .catch((e: unknown) => e)) as UnprocessableEntityException
        expect(error).toBeInstanceOf(UnprocessableEntityException)
        expect(JSON.stringify(error.getResponse())).not.toContain(value)
        expect((error.getResponse() as { code: string }).code).toBe(
          'GOVERNANCE_SECRET_CLASSIFIED'
        )
      }
    )

    it('does not flag ordinary legal policy keys and values', async () => {
      const m = setup({
        policies: [
          {
            key: 'PLATFORM_FEE_PERCENT',
            value: '2.5',
            unit: '%',
            status: 'active',
          },
          {
            key: 'CONTRACT_MUST_BE_WRITTEN',
            value: 'true',
            unit: 'boolean',
            status: 'active',
          },
          {
            key: 'TENANT_RIGHT_ON_OWNERSHIP_TRANSFER',
            value: 'Hợp đồng tiếp tục có hiệu lực theo Điều 173',
            status: 'active',
          },
          {
            key: 'PIT_RENTAL_EXEMPT_THRESHOLD',
            value: '100000000',
            unit: 'VND',
            status: 'active',
          },
        ],
      })
      await expect(m.service.publish(ADMIN)).resolves.toMatchObject({
        created: true,
      })
    })

    it('does not flag any seeded policy definition key', async () => {
      const m = setup({
        policies: Object.keys(POLICY_DEFINITIONS).map(key => ({
          key,
          value: '1',
          status: 'active',
        })),
      })
      await expect(m.service.publish(ADMIN)).resolves.toMatchObject({
        created: true,
      })
    })

    it('exposes the explicit denylist for review', () => {
      expect(GOVERNANCE_SECRET_KEY_PATTERNS.length).toBeGreaterThan(3)
      expect(GOVERNANCE_SECRET_VALUE_PATTERNS.length).toBeGreaterThan(3)
    })
  })

  describe('publish — canonical publication, versioning, idempotency', () => {
    it('persists a published, pending-ledger snapshot with version 1 and a canonical manifestHash', async () => {
      const m = setup()
      const { snapshot } = await m.service.publish(ADMIN)

      expect(snapshot.version).toBe(1)
      expect(snapshot.status).toBe('published')
      expect(snapshot.ledgerStatus).toBe('pending')
      expect(snapshot.manifestSchemaVersion).toBe(1)
      expect(snapshot.txHash).toBeNull()
      expect(snapshot.blockNumber).toBeNull()
      expect(snapshot.publishedBy).toBe('admin-1')
      expect(snapshot.publishedAt).toBeInstanceOf(Date)
      expect(snapshot.snapshotCode).toMatch(/^GOV-\d{6}$/)
      expect(snapshot.manifestHash).toBe(
        hashGovernanceEvidenceEnvelope(
          buildGovernanceEvidenceEnvelope({
            snapshotCode: snapshot.snapshotCode,
            components: snapshot.components,
          })
        )
      )
    })

    it('is deterministic regardless of the order sources return their rows', async () => {
      const a = setup()
      const b = setup({
        executionPolicies: [
          { policyId: 'DEPOSIT_FIRST', version: 2, contentHash: H('e') },
          { policyId: 'SIGN_FIRST', version: 1, contentHash: H('f') },
        ],
      })
      const first = await a.service.publish(ADMIN)
      const second = await b.service.publish(ADMIN)
      expect(first.snapshot.manifestHash).toBe(second.snapshot.manifestHash)
    })

    it('publishing an identical manifest again returns the existing snapshot (no new version)', async () => {
      const m = setup()
      const first = await m.service.publish(ADMIN)
      const second = await m.service.publish({ id: 'admin-2', role: 'admin' })

      expect(second.created).toBe(false)
      expect(second.snapshot).toBe(first.snapshot)
      expect(m.stored).toHaveLength(1)
      expect(second.snapshot.publishedBy).toBe('admin-1')
    })

    it('creates an immutable next version when a governed input changed, leaving the old one untouched', async () => {
      const m = setup()
      const first = await m.service.publish(ADMIN)
      const frozen = JSON.stringify(first.snapshot)

      m.policies.findAll.mockResolvedValue([
        {
          key: 'MAX_DEPOSIT_LIMIT_PERCENT',
          value: '4',
          unit: '%',
          status: 'active',
        },
      ])
      const second = await m.service.publish(ADMIN)

      expect(second.created).toBe(true)
      expect(second.snapshot.version).toBe(2)
      expect(second.snapshot.snapshotCode).not.toBe(first.snapshot.snapshotCode)
      expect(second.snapshot.manifestHash).not.toBe(first.snapshot.manifestHash)
      expect(JSON.stringify(first.snapshot)).toBe(frozen)
      expect(m.stored).toHaveLength(2)
    })

    it('retries with the next version when a concurrent publisher took the same version (duplicate key)', async () => {
      const m = setup()
      const realSave = m.repository.save.getMockImplementation()!
      let failures = 1
      m.repository.save.mockImplementation(
        (value: FabricGovernanceSnapshot) => {
          if (failures-- > 0) {
            // A concurrent publisher inserted v1 first.
            const winner = Object.assign(new FabricGovernanceSnapshot(), {
              _id: new ObjectId(),
              version: 1,
              snapshotCode: 'GOV-000001',
              status: 'published',
              manifestHash: H('9'),
            })
            m.stored.push(winner)
            return Promise.reject(
              Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
            )
          }
          return realSave(value)
        }
      )

      const { snapshot, created } = await m.service.publish(ADMIN)
      expect(created).toBe(true)
      expect(snapshot.version).toBe(2)
    })
  })

  describe('publish — outbox enqueue (privacy-safe)', () => {
    it('enqueues governance.published with only [snapshotId, version, manifestHash, schemaVersion]', async () => {
      const m = setup()
      const { snapshot } = await m.service.publish(ADMIN)
      const id = snapshot._id.toHexString()

      expect(m.outbox.enqueue).toHaveBeenCalledTimes(1)
      const input = m.outbox.enqueue.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(input).toMatchObject({
        aggregateType: 'governance-snapshot',
        aggregateId: id,
        eventType: 'governance.published',
        action: 'publishGovernanceSnapshot',
        args: [id, '1', snapshot.manifestHash, '1'],
      })
      expect(input.dependencyKey ?? null).toBeNull()
      expect(input.dependencyKeys ?? null).toBeNull()
    })

    it('never puts component values, policy values or terms text into the outbox input', async () => {
      const m = setup()
      await m.service.publish(ADMIN)
      const serialized = JSON.stringify(m.outbox.enqueue.mock.calls)
      expect(serialized).not.toContain('MAX_DEPOSIT_LIMIT_PERCENT')
      expect(serialized).not.toContain('rental-service-terms')
      expect(serialized).not.toContain('VN_INDIVIDUAL_RESIDENTIAL_LEASE')
      expect(serialized).not.toContain('admin-1')
    })

    it('re-enqueues (idempotently) when an identical publish finds a still-pending snapshot, healing a lost enqueue', async () => {
      const m = setup()
      await m.service.publish(ADMIN)
      await m.service.publish(ADMIN)
      expect(m.outbox.enqueue).toHaveBeenCalledTimes(2)
      expect(
        (m.outbox.enqueue.mock.calls[1]?.[0] as { aggregateId: string })
          .aggregateId
      ).toBe(
        (m.outbox.enqueue.mock.calls[0]?.[0] as { aggregateId: string })
          .aggregateId
      )
    })

    it('does not re-enqueue for an already-confirmed identical snapshot', async () => {
      const m = setup()
      const first = await m.service.publish(ADMIN)
      first.snapshot.ledgerStatus = 'confirmed-fabric'
      await m.service.publish(ADMIN)
      expect(m.outbox.enqueue).toHaveBeenCalledTimes(1)
    })
  })

  describe('read model', () => {
    it('lists snapshots newest first with pagination metadata', async () => {
      const m = setup()
      await m.service.publish(ADMIN)
      m.policies.findAll.mockResolvedValue([
        { key: 'MAX_DEPOSIT_LIMIT_PERCENT', value: '4', status: 'active' },
      ])
      await m.service.publish(ADMIN)

      const page = await m.service.list({ page: 1, limit: 1 })
      expect(page).toMatchObject({ total: 2, page: 1, limit: 1, totalPages: 2 })
      expect(page.items.map(s => s.version)).toEqual([2])
      expect(m.repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 1 })
      )
    })

    it('getById returns the snapshot and rejects unknown/malformed ids with GOVERNANCE_SNAPSHOT_NOT_FOUND', async () => {
      const m = setup()
      const { snapshot } = await m.service.publish(ADMIN)
      await expect(m.service.getById(snapshot._id.toHexString())).resolves.toBe(
        snapshot
      )
      await expect(
        m.service.getById(new ObjectId().toHexString())
      ).rejects.toBeInstanceOf(NotFoundException)
      await expect(m.service.getById('not-an-id')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
  })

  describe('findLatestEligibleForExecutionPolicy (D2 selection rule)', () => {
    it('returns the latest snapshot whose rentalExecutionPolicy contains the contract policy (and version)', async () => {
      const m = setup()
      const v1 = (await m.service.publish(ADMIN)).snapshot
      // v2 drops SIGN_FIRST
      m.executionPolicies.listActive.mockResolvedValue([
        { policyId: 'DEPOSIT_FIRST', version: 2, contentHash: H('e') },
      ])
      const v2 = (await m.service.publish(ADMIN)).snapshot

      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'DEPOSIT_FIRST',
          version: 2,
        })
      ).resolves.toBe(v2)
      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'SIGN_FIRST',
          version: 1,
        })
      ).resolves.toBe(v1)
    })

    it('requires the same policy version when one is given, and any version when it is not', async () => {
      const m = setup()
      const { snapshot } = await m.service.publish(ADMIN)
      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'SIGN_FIRST',
          version: 9,
        })
      ).resolves.toBeNull()
      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'SIGN_FIRST',
        })
      ).resolves.toBe(snapshot)
    })

    it('returns null when there is no snapshot, or no snapshot contains the policy', async () => {
      const m = setup()
      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'SIGN_FIRST',
        })
      ).resolves.toBeNull()
      await m.service.publish(ADMIN)
      await expect(
        m.service.findLatestEligibleForExecutionPolicy({ policyId: 'UNKNOWN' })
      ).resolves.toBeNull()
    })

    it('skips snapshots whose ledger evidence terminally failed', async () => {
      const m = setup()
      const first = (await m.service.publish(ADMIN)).snapshot
      m.policies.findAll.mockResolvedValue([
        { key: 'MAX_DEPOSIT_LIMIT_PERCENT', value: '4', status: 'active' },
      ])
      const second = (await m.service.publish(ADMIN)).snapshot
      second.ledgerStatus = 'failed-terminal'

      await expect(
        m.service.findLatestEligibleForExecutionPolicy({
          policyId: 'SIGN_FIRST',
        })
      ).resolves.toBe(first)
    })
  })

  describe('verify (tri-state + not-recorded)', () => {
    async function published(m: Mocks): Promise<FabricGovernanceSnapshot> {
      return (await m.service.publish(ADMIN)).snapshot
    }

    it('returns verified when the ledger record has the same manifestHash, version and schema version', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockResolvedValue({
        snapshotId: snapshot._id.toHexString(),
        version: 1,
        manifestHash: snapshot.manifestHash,
        manifestSchemaVersion: 1,
        txId: 'tx-real-1',
      })

      const result = await m.service.verify(snapshot._id.toHexString())

      expect(m.fabric.evaluateTransaction).toHaveBeenCalledWith(
        'readGovernanceSnapshot',
        [snapshot._id.toHexString()]
      )
      expect(result).toMatchObject({
        status: 'verified',
        version: 1,
        localManifestHash: snapshot.manifestHash,
        ledgerManifestHash: snapshot.manifestHash,
        txHash: 'tx-real-1',
        networkMode: 'fabric',
        mismatchFields: [],
      })
    })

    it('returns mismatch listing the differing fields when the ledger disagrees', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockResolvedValue({
        version: 1,
        manifestHash: H('0'),
        manifestSchemaVersion: 1,
        txId: 'tx-1',
      })
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('mismatch')
      expect(result.mismatchFields).toEqual(['manifestHash'])
      expect(result.ledgerManifestHash).toBe(H('0'))
    })

    it('returns mismatch when the stored manifest no longer hashes to its own manifestHash (local tampering)', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockResolvedValue({
        version: 1,
        manifestHash: snapshot.manifestHash,
        manifestSchemaVersion: 1,
      })
      snapshot.components.policySet[0]!.value = '999'
      snapshot.components = {
        ...snapshot.components,
        legalTerms: [{ id: 'tampered', version: 9, hash: H('7') }],
      }
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('mismatch')
      expect(result.mismatchFields).toContain('localManifestHash')
    })

    it('returns not-recorded when the ledger has no such snapshot (ERR_NOT_FOUND)', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockRejectedValue(
        new Error(
          'Fabric query failed: ERR_NOT_FOUND: governance snapshot does not exist'
        )
      )
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('not-recorded')
      expect(result.ledgerManifestHash).toBeNull()
    })

    it('returns unavailable (never verified or mismatch) when Fabric cannot be queried', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockRejectedValue(
        new Error(
          'FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is unavailable'
        )
      )
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('unavailable')
      expect(result.reason).toBe('FABRIC_UNAVAILABLE')
      expect(result.ledgerManifestHash).toBeNull()
    })

    it('treats any other query failure as unavailable without leaking the raw message', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.evaluateTransaction.mockRejectedValue(
        new Error('Fabric query failed: peer0.org1 secret-detail')
      )
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('unavailable')
      expect(JSON.stringify(result)).not.toContain('secret-detail')
    })

    it('is honest in simulation mode: never claims a ledger verification', async () => {
      const m = setup()
      const snapshot = await published(m)
      m.fabric.getStatus.mockReturnValue({ mode: 'simulation' })
      const result = await m.service.verify(snapshot._id.toHexString())
      expect(result.status).toBe('unavailable')
      expect(result.networkMode).toBe('simulation')
      expect(result.reason).toBe('FABRIC_SIMULATION_MODE')
      expect(m.fabric.evaluateTransaction).not.toHaveBeenCalled()
    })

    it('throws GOVERNANCE_SNAPSHOT_NOT_FOUND for an unknown snapshot', async () => {
      const m = setup()
      await expect(
        m.service.verify(new ObjectId().toHexString())
      ).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
