import { createHash } from 'node:crypto'
import { PassThrough, Readable, Writable } from 'node:stream'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { ContractEvidencePackageExportService } from './contract-evidence-package.export.service'
import { ContractEvidencePackageService } from './contract-evidence-package.service'
import { readZip } from '../utils/zip-reader.fixtures'
import type { Contract } from '../schemas/contract.schema'

const PDF = Buffer.from('%PDF-1.7 signed canonical contract '.repeat(40))
const PDF_HASH = createHash('sha256').update(PDF).digest('hex')
const CONTRACT_ID = new ObjectId()
const ARTIFACT_ID = new ObjectId()

type Row = Record<string, unknown>

function contract(overrides: Row = {}): Contract {
  return {
    _id: CONTRACT_ID,
    contractCode: 'HD-2026/001',
    status: 'active',
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
    contractHash: PDF_HASH,
    blockchainAddress: 'tx-activation',
    ledgerStatus: 'confirmed',
    depositAgreementId: null,
    artifactRef: { artifactId: ARTIFACT_ID.toHexString(), revision: 2 },
    ...overrides,
  } as unknown as Contract
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(
  options: {
    contract?: Contract
    pdf?: Buffer
    recordedHash?: string
    byteLength?: number
    openFails?: boolean
    config?: Record<string, number>
    mode?: 'fabric' | 'simulation'
    evaluate?: jest.Mock
    deposit?: Row | null
    payments?: Row[]
    amendments?: Row[]
    settlement?: Row | null
    governance?: Row | null
    events?: Row[]
    recordFails?: boolean
  } = {}
) {
  const pdf = options.pdf ?? PDF
  const events: Row[] = options.events ?? [
    {
      eventType: 'contract.activated',
      aggregateType: 'contract',
      status: 'confirmed',
      networkMode: 'fabric',
      txId: 'tx-activation',
      blockNumber: 7,
      recordedAt: '2026-10-01T00:00:00.000Z',
      payloadHash: PDF_HASH,
      dependsOn: null,
      attempts: 1,
      errorCode: null,
    },
  ]
  const open = jest.fn(() =>
    options.openFails
      ? Promise.reject(new Error('GridFS FileNotFound secret-detail'))
      : Promise.resolve(Readable.from([pdf.subarray(0, 50), pdf.subarray(50)]))
  )
  const artifactService = {
    openCanonicalArtifactForExport: jest.fn().mockResolvedValue({
      artifact: {
        _id: ARTIFACT_ID,
        revision: 2,
        byteLength: options.byteLength ?? PDF.length,
        artifactHash: options.recordedHash ?? PDF_HASH,
      },
      recordedHash: options.recordedHash ?? PDF_HASH,
      open,
    }),
  }
  const contractsService = {
    findOneForUser: jest.fn(
      (id: string, actorId: string, isStaff: boolean): Promise<Contract> => {
        const c = options.contract ?? contract()
        if (!isStaff && c.tenantId !== actorId && c.landlordId !== actorId) {
          return Promise.reject(
            new ForbiddenException('CONTRACT_ACCESS_DENIED')
          )
        }
        return Promise.resolve(c)
      }
    ),
  }
  const fabric = {
    getStatus: jest.fn(() => ({ mode: options.mode ?? 'fabric' })),
    evaluateTransaction:
      options.evaluate ?? jest.fn().mockResolvedValue({ valid: true }),
  }
  const config = {
    get: jest.fn(
      (key: string) => options.config?.[key.replace('evidencePackage.', '')]
    ),
  }
  const packageService = new ContractEvidencePackageService(config as never)
  const records: Row[] = []
  const eventService = {
    record: jest.fn((input: Row) => {
      if (options.recordFails) return Promise.reject(new Error('audit down'))
      records.push(input)
      return Promise.resolve(input)
    }),
  }
  const repo = (
    rows: Row[] | Row | null
  ): { find: jest.Mock; findOne: jest.Mock } => ({
    find: jest.fn().mockResolvedValue(Array.isArray(rows) ? rows : []),
    findOne: jest.fn().mockResolvedValue(Array.isArray(rows) ? null : rows),
  })
  const service = new ContractEvidencePackageExportService(
    contractsService as never,
    artifactService as never,
    packageService,
    {
      getContractLedgerEvidence: jest.fn().mockResolvedValue({ events }),
    } as never,
    fabric as never,
    repo(options.deposit ?? null) as never,
    repo(options.payments ?? []) as never,
    repo(options.amendments ?? []) as never,
    repo(options.settlement ?? null) as never,
    {
      getById: jest.fn().mockResolvedValue(options.governance ?? undefined),
    } as never,
    eventService as never
  )
  return {
    service,
    artifactService,
    contractsService,
    fabric,
    open,
    records,
    eventService,
  }
}

function collector(): { sink: Writable; bytes: () => Buffer } {
  const chunks: Buffer[] = []
  return {
    sink: new Writable({
      write(chunk: Buffer, _e, cb): void {
        chunks.push(chunk)
        cb()
      },
    }),
    bytes: () => Buffer.concat(chunks),
  }
}

async function exportZip(
  ctx: ReturnType<typeof setup>,
  actor: { id: string; roles: string[] },
  query: { revision?: number } = {}
): Promise<{
  entries: ReturnType<typeof readZip>
  prepared: Awaited<ReturnType<ContractEvidencePackageExportService['prepare']>>
}> {
  const prepared = await ctx.service.prepare(
    CONTRACT_ID.toHexString(),
    actor,
    query
  )
  const { sink, bytes } = collector()
  await prepared.run(sink)
  return { entries: readZip(bytes()), prepared }
}

function json(entries: ReturnType<typeof readZip>, name: string): unknown {
  return JSON.parse(entries.find(e => e.name === name)!.data.toString('utf8'))
}

describe('ContractEvidencePackageExportService (PROP-399 tasks 9.5/9.6)', () => {
  describe('access matrix', () => {
    it.each([
      [
        'tenant participant',
        { id: 'tenant-1', roles: ['tenant'] },
        'participant',
        'tenant',
      ],
      [
        'landlord participant',
        { id: 'landlord-1', roles: ['landlord'] },
        'participant',
        'landlord',
      ],
      ['staff', { id: 'staff-9', roles: ['staff'] }, 'operator', 'staff'],
      ['admin', { id: 'admin-9', roles: ['admin'] }, 'operator', 'admin'],
    ])(
      'exports for a %s with the right audience and audit role',
      async (_l, actor, audience, auditRole) => {
        const ctx = setup()
        const { entries, prepared } = await exportZip(ctx, actor)
        const manifest = json(entries, 'manifest.json') as {
          audience: string
          packageHash: string
        }
        expect(manifest.audience).toBe(audience)
        expect(manifest.packageHash).toBe(prepared.packageHash)
        expect(ctx.records.every(r => r.actorRole === auditRole)).toBe(true)
        expect(ctx.records.every(r => r.actorId === actor.id)).toBe(true)
      }
    )

    it('rejects an unrelated user before touching any artifact or writing an audit event', async () => {
      const ctx = setup()
      await expect(
        ctx.service.prepare(CONTRACT_ID.toHexString(), {
          id: 'stranger',
          roles: ['tenant'],
        })
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(
        ctx.artifactService.openCanonicalArtifactForExport
      ).not.toHaveBeenCalled()
      expect(ctx.open).not.toHaveBeenCalled()
      expect(ctx.records).toHaveLength(0)
    })

    it('forwards the requested revision to the artifact resolver and surfaces EVIDENCE_VERSION_NOT_FOUND', async () => {
      const ctx = setup()
      ctx.artifactService.openCanonicalArtifactForExport.mockRejectedValue(
        new NotFoundException({ code: 'EVIDENCE_VERSION_NOT_FOUND' })
      )
      const error = await ctx.service
        .prepare(
          CONTRACT_ID.toHexString(),
          { id: 'tenant-1', roles: ['tenant'] },
          { revision: 9 }
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(NotFoundException)
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'EVIDENCE_VERSION_NOT_FOUND',
      })
      expect(
        ctx.artifactService.openCanonicalArtifactForExport
      ).toHaveBeenCalledWith(expect.anything(), 9)
      expect(ctx.records).toHaveLength(0)
    })
  })

  describe('incomplete evidence and integrity (nothing is streamed)', () => {
    const tenant = { id: 'tenant-1', roles: ['tenant'] }

    it.each([
      [
        'contract not locked',
        new ConflictException('CONTRACT_ARTIFACT_NOT_LOCKED'),
      ],
      [
        'artifact record missing',
        new NotFoundException('CONTRACT_ARTIFACT_NOT_FOUND'),
      ],
      [
        'storage unavailable',
        new ServiceUnavailableException(
          'CONTRACT_ARTIFACT_STORAGE_UNAVAILABLE'
        ),
      ],
    ])('maps %s to EVIDENCE_PACKAGE_INCOMPLETE', async (_label, failure) => {
      const ctx = setup()
      ctx.artifactService.openCanonicalArtifactForExport.mockRejectedValue(
        failure
      )
      const error = await ctx.service
        .prepare(CONTRACT_ID.toHexString(), tenant)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect(
        (error as UnprocessableEntityException).getResponse()
      ).toMatchObject({ code: 'EVIDENCE_PACKAGE_INCOMPLETE' })
    })

    it('maps unreadable PDF bytes to EVIDENCE_PACKAGE_INCOMPLETE without leaking the storage error', async () => {
      const ctx = setup({ openFails: true })
      const error = await ctx.service
        .prepare(CONTRACT_ID.toHexString(), tenant)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect(
        JSON.stringify((error as UnprocessableEntityException).getResponse())
      ).not.toContain('secret-detail')
    })

    it('blocks the export and records a sanitized integrity finding when stored bytes differ from the recorded hash', async () => {
      const tampered = Buffer.from(PDF)
      tampered[5] = tampered[5]! ^ 0xff
      const ctx = setup({ pdf: tampered })
      const error = await ctx.service
        .prepare(CONTRACT_ID.toHexString(), tenant)
        .catch((e: unknown) => e)

      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'EVIDENCE_ARTIFACT_MISMATCH',
      })
      expect(ctx.records.map(r => r.eventType)).toEqual([
        'evidence-package.integrity-finding',
      ])
      expect(ctx.records[0]).toMatchObject({
        reasonCode: 'EVIDENCE_ARTIFACT_MISMATCH',
        actorRole: 'tenant',
      })
      expect(JSON.stringify(ctx.records)).not.toContain(PDF_HASH)
    })

    it('treats a stored file of the wrong length as a mismatch', async () => {
      const ctx = setup({ pdf: Buffer.concat([PDF, Buffer.from('EXTRA')]) })
      await expect(
        ctx.service.prepare(CONTRACT_ID.toHexString(), tenant)
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('maps a superseded/inconsistent artifact record to the same integrity error and finding', async () => {
      const ctx = setup()
      ctx.artifactService.openCanonicalArtifactForExport.mockRejectedValue(
        new ConflictException('CONTRACT_ARTIFACT_SUPERSEDED')
      )
      const error = await ctx.service
        .prepare(CONTRACT_ID.toHexString(), tenant)
        .catch((e: unknown) => e)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'EVIDENCE_ARTIFACT_MISMATCH',
      })
      expect(ctx.records.map(r => r.eventType)).toEqual([
        'evidence-package.integrity-finding',
      ])
    })

    it('rejects an oversized declared package with EVIDENCE_PACKAGE_TOO_LARGE before any streaming', async () => {
      const ctx = setup({ config: { maxBytes: 500 } })
      const error = await ctx.service
        .prepare(CONTRACT_ID.toHexString(), tenant)
        .catch((e: unknown) => e)
      expect(
        (error as { getResponse: () => unknown }).getResponse()
      ).toMatchObject({
        code: 'EVIDENCE_PACKAGE_TOO_LARGE',
        limit: 'maxBytes',
      })
      expect(ctx.records).toHaveLength(0)
    })
  })

  describe('honest verification report', () => {
    const tenant = { id: 'tenant-1', roles: ['tenant'] }
    async function report(options: Parameters<typeof setup>[0]): Promise<{
      ledger: { status: string; reason: string | null }
      endToEnd: boolean
      projection: { status: string }
      database: { status: string }
    }> {
      const ctx = setup(options)
      const { entries } = await exportZip(ctx, tenant)
      return json(entries, 'verification-report.json') as never
    }

    it('reports every layer verified when Fabric confirms the anchored hash', async () => {
      const result = await report({})
      expect(result).toMatchObject({
        database: { status: 'verified' },
        projection: { status: 'verified' },
        ledger: { status: 'verified' },
        endToEnd: true,
      })
    })

    it('still generates the package with ledger unavailable (never end-to-end) when Fabric cannot be queried', async () => {
      const result = await report({
        evaluate: jest
          .fn()
          .mockRejectedValue(new Error('FABRIC_GATEWAY_UNAVAILABLE')),
      })
      expect(result.ledger).toEqual({
        status: 'unavailable',
        reason: 'FABRIC_UNAVAILABLE',
      })
      expect(result.endToEnd).toBe(false)
    })

    it('reports a ledger mismatch honestly', async () => {
      const result = await report({
        evaluate: jest.fn().mockResolvedValue({ valid: false }),
      })
      expect(result.ledger.status).toBe('mismatch')
      expect(result.endToEnd).toBe(false)
    })

    it('never claims verification in simulation and does not query Fabric', async () => {
      const evaluate = jest.fn()
      const result = await report({ mode: 'simulation', evaluate })
      expect(result.ledger).toEqual({
        status: 'unavailable',
        reason: 'FABRIC_SIMULATION_MODE',
      })
      expect(evaluate).not.toHaveBeenCalled()
    })

    it('marks the ledger as not recorded for a contract without confirmed ledger evidence', async () => {
      const evaluate = jest.fn()
      const result = await report({
        contract: contract({
          ledgerStatus: 'pending',
          blockchainAddress: null,
        }),
        evaluate,
      })
      expect(result.ledger).toEqual({
        status: 'unavailable',
        reason: 'LEDGER_NOT_RECORDED',
      })
      expect(evaluate).not.toHaveBeenCalled()
    })

    it('flags a projection mismatch when the projected contract hash differs from the artifact hash', async () => {
      const result = await report({
        contract: contract({ contractHash: 'f'.repeat(64) }),
      })
      expect(result.projection.status).toBe('mismatch')
    })
  })

  describe('gathered evidence', () => {
    it('includes the optional categories that exist for the contract and never any personal data', async () => {
      const ctx = setup({
        contract: contract({
          depositAgreementId: new ObjectId().toHexString(),
          terminatedAt: new Date('2026-12-01T00:00:00.000Z'),
          terminationReasonCode: 'MUTUAL',
          terminationReason: 'PRIVATE TEXT',
          tenantName: 'Nguyen Van A',
          tenantCccd: '079123456789',
          governanceSnapshotRef: {
            snapshotId: 'snap-1',
            version: 2,
            manifestHash: 'b'.repeat(64),
          },
        }),
        deposit: {
          _id: new ObjectId(),
          amount: 100,
          depositHash: 'd'.repeat(64),
          status: 'paid',
          paidAt: null,
          ledgerStatus: 'confirmed',
        },
        payments: [
          {
            _id: new ObjectId(),
            type: 'rent',
            amount: 10,
            status: 'paid',
            paymentHash: 'c'.repeat(64),
            payerRole: 'tenant',
            payerName: 'Nguyen Van A',
          },
        ],
        amendments: [
          {
            _id: new ObjectId(),
            sequence: 1,
            status: 'effective',
            contentHash: 'e'.repeat(64),
            effectiveFrom: new Date('2026-11-01'),
          },
          {
            _id: new ObjectId(),
            sequence: 2,
            status: 'draft',
            contentHash: '9'.repeat(64),
            effectiveFrom: new Date('2026-12-01'),
          },
        ],
        settlement: {
          _id: new ObjectId(),
          status: 'paid',
          total: 5,
          statementHash: 'a'.repeat(64),
          lines: [
            {
              kind: 'FIRST_RENT',
              amount: 5,
              paymentId: 'p-1',
              tenantName: 'Nguyen Van A',
            },
          ],
          settlementEvidence: {
            manifestHash: '1'.repeat(64),
            ledgerStatus: 'confirmed-fabric',
            txHash: 'tx-s',
          },
          handover: {
            revision: 1,
            handoverHash: '2'.repeat(64),
            completedAt: new Date('2026-10-10T00:00:00.000Z'),
            overrideReason: null,
            meterReadings: { electricity: 1 },
            keyCount: 2,
            notes: 'PRIVATE NOTE',
          },
          handoverEvidence: {
            manifestHash: '3'.repeat(64),
            ledgerStatus: 'confirmed-fabric',
            txHash: 'tx-h',
          },
        },
        governance: {
          snapshotCode: 'GOV-000002',
          components: { legalTerms: [] },
        },
      })
      const { entries } = await exportZip(ctx, {
        id: 'admin-1',
        roles: ['admin'],
      })
      const names = entries.map(e => e.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'evidence/ledger-events.json',
          'evidence/governance-snapshot.json',
          'evidence/deposit.json',
          'evidence/payments.json',
          'evidence/amendments.json',
          'evidence/termination.json',
          'evidence/settlement.json',
          'evidence/handover.json',
        ])
      )
      expect(json(entries, 'evidence/amendments.json')).toHaveLength(1)
      const all = entries.map(e => e.data.toString('utf8')).join('\n')
      for (const forbidden of [
        'Nguyen Van A',
        '079123456789',
        'PRIVATE TEXT',
        'PRIVATE NOTE',
        'meterReadings',
        'keyCount',
      ]) {
        expect(all).not.toContain(forbidden)
      }
    })

    it('marks absent categories as not present and still succeeds', async () => {
      const ctx = setup()
      const { entries } = await exportZip(ctx, {
        id: 'tenant-1',
        roles: ['tenant'],
      })
      const manifest = json(entries, 'manifest.json') as {
        categories: Record<string, { present: boolean }>
      }
      expect(manifest.categories.payments?.present).toBe(false)
      expect(manifest.categories.settlement?.present).toBe(false)
      expect(manifest.categories.ledgerEvents?.present).toBe(true)
    })
  })

  describe('export audit and delivery', () => {
    const tenant = { id: 'tenant-1', roles: ['tenant'] }

    it('records started then completed, with no package content in the audit trail', async () => {
      const ctx = setup()
      await exportZip(ctx, tenant)
      expect(ctx.records.map(r => r.eventType)).toEqual([
        'evidence-package.export-started',
        'evidence-package.export-completed',
      ])
      expect(new Set(ctx.records.map(r => r.transitionKey)).size).toBe(2)
      expect(JSON.stringify(ctx.records)).not.toContain('PDF')
    })

    it('records an aborted export (client-abort) and never a completion when the client disconnects', async () => {
      const ctx = setup()
      const prepared = await ctx.service.prepare(
        CONTRACT_ID.toHexString(),
        tenant
      )
      // A source that never ends keeps the stream open until the client goes away.
      ctx.open.mockImplementation(() =>
        Promise.resolve(new PassThrough() as unknown as Readable)
      )
      const sink = new PassThrough()
      const pending = prepared.run(sink).catch((e: unknown) => e)
      await new Promise(resolve => setImmediate(resolve))
      sink.destroy()
      await pending
      expect(ctx.records.map(r => r.eventType)).toEqual([
        'evidence-package.export-started',
        'evidence-package.export-aborted',
      ])
      expect(ctx.records[1]).toMatchObject({ reasonCode: 'CLIENT_ABORT' })
    })

    it('records an aborted export (stream error) when GridFS fails mid-stream', async () => {
      const ctx = setup()
      const prepared = await ctx.service.prepare(
        CONTRACT_ID.toHexString(),
        tenant
      )
      const broken = new PassThrough()
      ctx.open.mockImplementation(() =>
        Promise.resolve(broken as unknown as Readable)
      )
      const { sink } = collector()
      const pending = prepared.run(sink).catch((e: unknown) => e)
      broken.write(PDF.subarray(0, 100))
      await new Promise(resolve => setImmediate(resolve))
      broken.destroy(new Error('connection reset'))
      await pending
      expect(ctx.records[1]).toMatchObject({
        eventType: 'evidence-package.export-aborted',
        reasonCode: 'STREAM_ERROR',
      })
    })

    it('records an integrity finding plus an abort when the bytes change between verification and streaming', async () => {
      const ctx = setup()
      const prepared = await ctx.service.prepare(
        CONTRACT_ID.toHexString(),
        tenant
      )
      const swapped = Buffer.from(PDF)
      swapped[1] = swapped[1]! ^ 0xff
      ctx.open.mockImplementation(() =>
        Promise.resolve(Readable.from([swapped]))
      )
      const { sink } = collector()
      await expect(prepared.run(sink)).rejects.toBeInstanceOf(ConflictException)
      expect(ctx.records.map(r => r.eventType)).toEqual([
        'evidence-package.export-started',
        'evidence-package.integrity-finding',
        'evidence-package.export-aborted',
      ])
    })

    it('does not fail the export when the audit trail is unavailable', async () => {
      const ctx = setup({ recordFails: true })
      const { entries } = await exportZip(ctx, tenant)
      expect(entries.length).toBeGreaterThan(2)
    })

    it('builds a safe download filename from the contract code and revision', async () => {
      const ctx = setup({
        contract: contract({ contractCode: 'HD/2026 "x";../1' }),
      })
      const prepared = await ctx.service.prepare(
        CONTRACT_ID.toHexString(),
        tenant
      )
      expect(prepared.filename).toBe('evidence-HD2026x1-r2.zip')
      expect(prepared.filename).toMatch(/^[A-Za-z0-9._-]+$/)
      expect(prepared.contentType).toBe('application/zip')
      expect(prepared.revision).toBe(2)
    })

    it('verifies by streaming then streams again, never converting the PDF to a Buffer', async () => {
      const ctx = setup()
      await exportZip(ctx, tenant)
      expect(ctx.open).toHaveBeenCalledTimes(2)
    })
  })
})
