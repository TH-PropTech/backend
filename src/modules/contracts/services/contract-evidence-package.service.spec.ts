import { createHash } from 'node:crypto'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import {
  ContractEvidencePackageService,
  type EvidencePackageInput,
} from './contract-evidence-package.service'

const HASH = 'a'.repeat(64)
const GOV_HASH = 'b'.repeat(64)

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function baseInput(
  overrides: Partial<EvidencePackageInput> = {}
): EvidencePackageInput {
  return {
    contract: { id: 'contract-1', contractCode: 'HD-001', status: 'active' },
    viewer: { role: 'tenant' },
    artifact: {
      artifactId: 'artifact-1',
      revision: 3,
      contentType: 'application/pdf',
      byteLength: 123456,
      recordedHash: HASH,
      computedHash: HASH,
    },
    ledgerEvents: [
      {
        eventType: 'contract.activated',
        aggregateType: 'contract',
        status: 'confirmed',
        networkMode: 'fabric',
        txId: 'tx-1',
        blockNumber: 12,
        recordedAt: '2026-10-01T10:00:00.000Z',
        payloadHash: HASH,
        dependsOn: null,
        attempts: 3,
        errorCode: null,
        explorerUrl: 'https://explorer.example.com/tx/tx-1',
        id: 'outbox-1',
      },
    ],
    governance: {
      snapshotId: 'snap-1',
      snapshotCode: 'GOV-000001',
      version: 2,
      manifestHash: GOV_HASH,
      components: {
        legalTerms: [{ id: 'terms', version: 1, hash: HASH }],
        policySet: [{ key: 'K', value: '5', unit: '%', hash: HASH }],
      },
    },
    projection: { expectedHash: HASH, projectedHash: HASH },
    ledger: { status: 'verified', networkMode: 'fabric' },
    generatedAt: new Date('2026-10-02T00:00:00.000Z'),
    ...overrides,
  }
}

describe('ContractEvidencePackageService manifest builder (PROP-399 tasks 9.2/9.3)', () => {
  const service = new ContractEvidencePackageService()

  describe('stable logical hashes and generation metadata exclusion', () => {
    it('yields identical entry hashes and package hash for unchanged sources, whatever the generation time or input order', () => {
      const payments = [
        {
          paymentId: 'p-2',
          type: 'rent',
          amount: 20,
          status: 'paid',
          paymentHash: HASH,
          payerRole: 'tenant',
        },
        {
          paymentId: 'p-1',
          type: 'rent',
          amount: 10,
          status: 'paid',
          paymentHash: HASH,
          payerRole: 'tenant',
        },
      ]
      const first = service.buildPlan(baseInput({ payments }))
      const second = service.buildPlan(
        baseInput({
          payments: [...payments].reverse(),
          generatedAt: new Date('2030-01-01T00:00:00.000Z'),
        })
      )

      expect(second.packageHash).toBe(first.packageHash)
      expect(second.entries.map(e => [e.path, e.sha256, e.byteLength])).toEqual(
        first.entries.map(e => [e.path, e.sha256, e.byteLength])
      )
      expect(first.manifest.generatedAt).not.toBe(second.manifest.generatedAt)
      expect(first.packageHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('is independent of JSON key order inside the records', () => {
      const a = service.buildPlan(
        baseInput({
          payments: [
            { paymentId: 'p-1', amount: 10, type: 'rent', status: 'paid' },
          ],
        })
      )
      const b = service.buildPlan(
        baseInput({
          payments: [
            { status: 'paid', type: 'rent', amount: 10, paymentId: 'p-1' },
          ],
        })
      )
      expect(b.packageHash).toBe(a.packageHash)
    })

    it('does not depend on the viewing participant when the visible evidence is identical', () => {
      const tenant = service.buildPlan(
        baseInput({ viewer: { role: 'tenant' } })
      )
      const landlord = service.buildPlan(
        baseInput({ viewer: { role: 'landlord' } })
      )
      expect(landlord.packageHash).toBe(tenant.packageHash)
    })

    it('hashes every JSON entry over its exact canonical bytes and reports its byte length', () => {
      const plan = service.buildPlan(baseInput())
      for (const entry of plan.entries) {
        if (entry.source.type !== 'json') continue
        expect(entry.sha256).toBe(sha256(entry.source.content))
        expect(entry.byteLength).toBe(Buffer.byteLength(entry.source.content))
        expect(entry.mediaType).toBe('application/json')
      }
    })

    it('computes the package hash from sorted logical entry metadata only', () => {
      const plan = service.buildPlan(baseInput())
      const manifest = JSON.parse(plan.manifestJson) as { packageHash: string }
      expect(manifest.packageHash).toBe(plan.packageHash)
      expect(plan.manifestJson).not.toContain(
        '"packageHash":"' + sha256('x') + '"'
      )
    })
  })

  describe('changed artifact detection', () => {
    it('changes the affected entry hash and the package hash for a new valid artifact version, leaving the prior plan intact', () => {
      const prior = service.buildPlan(baseInput())
      const priorSnapshot = JSON.stringify(prior.manifest)
      const next = service.buildPlan(
        baseInput({
          artifact: {
            artifactId: 'artifact-1',
            revision: 4,
            contentType: 'application/pdf',
            byteLength: 223344,
            recordedHash: 'c'.repeat(64),
            computedHash: 'c'.repeat(64),
          },
        })
      )
      const priorPdf = prior.entries.find(e => e.category === 'contract')
      const nextPdf = next.entries.find(e => e.category === 'contract')
      expect(priorPdf?.path).toBe('contract/contract-r3.pdf')
      expect(nextPdf?.path).toBe('contract/contract-r4.pdf')
      expect(nextPdf?.sha256).not.toBe(priorPdf?.sha256)
      expect(next.packageHash).not.toBe(prior.packageHash)
      expect(JSON.stringify(prior.manifest)).toBe(priorSnapshot)
    })

    it('blocks the export with EVIDENCE_ARTIFACT_MISMATCH when stored bytes do not match the recorded canonical hash, with a sanitized finding', () => {
      let error: unknown
      try {
        service.buildPlan(
          baseInput({
            artifact: {
              artifactId: 'artifact-1',
              revision: 3,
              contentType: 'application/pdf',
              byteLength: 10,
              recordedHash: HASH,
              computedHash: 'd'.repeat(64),
            },
          })
        )
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(ConflictException)
      const body = (error as ConflictException).getResponse() as {
        code: string
        finding: Record<string, unknown>
      }
      expect(body.code).toBe('EVIDENCE_ARTIFACT_MISMATCH')
      expect(body.finding).toEqual({
        category: 'artifact_hash_mismatch',
        contractId: 'contract-1',
        artifactId: 'artifact-1',
        revision: 3,
      })
      expect(JSON.stringify(body)).not.toContain('d'.repeat(64))
    })

    it('rejects with EVIDENCE_PACKAGE_INCOMPLETE when the canonical signed artifact is absent', () => {
      for (const artifact of [
        null,
        { ...baseInput().artifact!, byteLength: 0 },
      ]) {
        let error: unknown
        try {
          service.buildPlan(baseInput({ artifact }))
        } catch (caught) {
          error = caught
        }
        expect(error).toBeInstanceOf(UnprocessableEntityException)
        expect(
          (error as UnprocessableEntityException).getResponse()
        ).toMatchObject({
          code: 'EVIDENCE_PACKAGE_INCOMPLETE',
        })
      }
    })
  })

  describe('layout and streaming descriptors', () => {
    it('orders entries per design D8 with manifest.json first and a GridFS artifact descriptor for the PDF', () => {
      const plan = service.buildPlan(
        baseInput({
          deposit: {
            depositId: 'd-1',
            amount: 100,
            depositHash: HASH,
            status: 'paid',
          },
          payments: [
            { paymentId: 'p-1', type: 'rent', amount: 1, status: 'paid' },
          ],
          amendments: [{ amendmentId: 'a-1', sequence: 1, contentHash: HASH }],
          termination: {
            reasonCode: 'MUTUAL',
            reasonHash: HASH,
            terminatedAt: '2026-12-01T00:00:00.000Z',
          },
          settlement: {
            settlementId: 's-1',
            status: 'paid',
            total: 5,
            statementHash: HASH,
          },
          handover: {
            settlementId: 's-1',
            revision: 1,
            handoverHash: HASH,
            completedAt: '2026-10-05T00:00:00.000Z',
          },
        })
      )
      expect(plan.orderedEntries().map(e => e.path)).toEqual([
        'manifest.json',
        'verification-report.json',
        'contract/contract-r3.pdf',
        'evidence/ledger-events.json',
        'evidence/governance-snapshot.json',
        'evidence/deposit.json',
        'evidence/payments.json',
        'evidence/amendments.json',
        'evidence/termination.json',
        'evidence/settlement.json',
        'evidence/handover.json',
      ])
      const pdf = plan.entries.find(e => e.path === 'contract/contract-r3.pdf')
      expect(pdf).toMatchObject({
        mediaType: 'application/pdf',
        byteLength: 123456,
        sha256: HASH,
        source: { type: 'artifact', artifactId: 'artifact-1', revision: 3 },
      })
      // The manifest entry carries its own canonical content but is not part of the logical hash.
      expect(plan.orderedEntries()[0]?.source).toMatchObject({ type: 'json' })
      expect(plan.entries.find(e => e.path === 'manifest.json')).toBeUndefined()
    })

    it('lists every entry with media type, byte length and SHA-256 in the manifest', () => {
      const plan = service.buildPlan(baseInput())
      expect(plan.manifest.entries).toEqual(
        plan.entries.map(e => ({
          path: e.path,
          category: e.category,
          mediaType: e.mediaType,
          byteLength: e.byteLength,
          sha256: e.sha256,
        }))
      )
      expect(plan.manifest).toMatchObject({
        manifestVersion: 1,
        contract: {
          id: 'contract-1',
          contractCode: 'HD-001',
          artifactId: 'artifact-1',
          artifactRevision: 3,
        },
        audience: 'participant',
        governanceSnapshot: {
          snapshotId: 'snap-1',
          version: 2,
          manifestHash: GOV_HASH,
        },
      })
      expect(plan.manifest.ledgerEventSummary).toEqual({
        total: 1,
        byEventType: { 'contract.activated': 1 },
      })
    })
  })

  describe('optional evidence categories', () => {
    it('marks absent categories as not present without fabricating records', () => {
      const plan = service.buildPlan(baseInput({ governance: null }))
      expect(plan.manifest.categories).toEqual({
        ledgerEvents: { present: true, entry: 'evidence/ledger-events.json' },
        governance: { present: false, entry: null },
        deposit: { present: false, entry: null },
        payments: { present: false, entry: null },
        amendments: { present: false, entry: null },
        termination: { present: false, entry: null },
        settlement: { present: false, entry: null },
        handover: { present: false, entry: null },
        moveOutHandover: { present: false, entry: null },
        depositStatement: { present: false, entry: null },
        depositRefunds: { present: false, entry: null },
      })
      expect(plan.entries.map(e => e.path)).toEqual([
        'verification-report.json',
        'contract/contract-r3.pdf',
        'evidence/ledger-events.json',
      ])
      expect(plan.manifest.governanceSnapshot).toBeNull()
    })

    it('adds move-out entries, keeps party content, strips secrets, and flags refunds as declarations', () => {
      const plan = service.buildPlan(
        baseInput({
          governance: null,
          moveOut: {
            moveOutPolicy: { responseDays: 3 },
            handover: {
              revision: 1,
              notes: 'ghi chú',
              apiKey: 'SECRET',
              status: 'completed',
            },
            statement: {
              status: 'closed',
              lines: [{ id: 'a', reason: 'x', amount: 1 }],
              refunds: [
                { id: 'r', amount: 1, recordedAt: new Date('2026-01-01') },
              ],
            },
          },
        })
      )
      const paths = plan.entries.map(e => e.path)
      expect(paths).toEqual(
        expect.arrayContaining([
          'evidence/move-out-handover.json',
          'evidence/deposit-statement.json',
          'evidence/deposit-refunds.json',
        ])
      )
      const content = plan.entries
        .filter(e => e.path.includes('move-out-handover'))
        .map(e => (e.source as { content: string }).content)
        .join()
      expect(content).toContain('ghi chú')
      expect(content).toContain('responseDays')
      expect(content).not.toContain('SECRET')
      expect(plan.verification.notices).toEqual([
        'REFUND_RECORDS_ARE_LANDLORD_DECLARATIONS_ACKNOWLEDGED_BY_TENANT',
      ])
    })

    it('treats moveOut null or with no refunds as absent and adds no notice', () => {
      const plan = service.buildPlan(
        baseInput({
          governance: null,
          moveOut: {
            moveOutPolicy: null,
            handover: null,
            statement: { status: 'draft', lines: [], refunds: [] },
          },
        })
      )
      expect(plan.manifest.categories.moveOutHandover.present).toBe(false)
      expect(plan.manifest.categories.depositStatement.present).toBe(true)
      expect(plan.manifest.categories.depositRefunds.present).toBe(false)
      expect(plan.verification.notices).toBeUndefined()
      expect(
        service.buildPlan(baseInput({ governance: null, moveOut: null }))
          .manifest.categories.depositStatement.present
      ).toBe(false)
    })

    it('treats empty arrays like absent categories and still succeeds with no ledger events', () => {
      const plan = service.buildPlan(
        baseInput({ payments: [], amendments: [], ledgerEvents: [] })
      )
      expect(plan.manifest.categories.payments.present).toBe(false)
      expect(plan.manifest.categories.amendments.present).toBe(false)
      expect(plan.manifest.categories.ledgerEvents.present).toBe(false)
    })

    it('includes present categories and flags them', () => {
      const plan = service.buildPlan(
        baseInput({
          settlement: {
            settlementId: 's-1',
            status: 'paid',
            total: 5,
            statementHash: HASH,
          },
        })
      )
      expect(plan.manifest.categories.settlement).toEqual({
        present: true,
        entry: 'evidence/settlement.json',
      })
    })
  })

  describe('role-specific contents', () => {
    const operatorOnly = {
      attempts: 3,
      errorCode: 'TERMINAL_CONFLICT',
    }
    const events = [
      {
        eventType: 'handover.completed',
        aggregateType: 'move-in-handover',
        status: 'failed',
        networkMode: 'fabric',
        txId: null,
        blockNumber: null,
        recordedAt: null,
        payloadHash: HASH,
        dependsOn: null,
        ...operatorOnly,
      },
    ]

    function ledgerJson(
      plan: ReturnType<ContractEvidencePackageService['buildPlan']>
    ): unknown {
      const entry = plan.entries.find(
        e => e.path === 'evidence/ledger-events.json'
      )
      return JSON.parse((entry?.source as { content: string }).content)
    }

    it('shows participants only participant-visible event fields and operators the delivery diagnostics', () => {
      const participant = ledgerJson(
        service.buildPlan(
          baseInput({
            ledgerEvents: events,
            viewer: { role: 'landlord' },
          })
        )
      )
      const operator = ledgerJson(
        service.buildPlan(
          baseInput({
            ledgerEvents: events,
            viewer: { role: 'staff' },
          })
        )
      )
      expect(JSON.stringify(participant)).not.toContain('TERMINAL_CONFLICT')
      expect(JSON.stringify(participant)).not.toContain('attempts')
      expect(JSON.stringify(operator)).toContain('TERMINAL_CONFLICT')
      expect(JSON.stringify(operator)).toContain('attempts')
    })

    it('limits the governance entry to the snapshot reference for participants and adds component refs for operators', () => {
      const find = (
        plan: ReturnType<ContractEvidencePackageService['buildPlan']>
      ): Record<string, unknown> =>
        JSON.parse(
          (
            plan.entries.find(
              e => e.path === 'evidence/governance-snapshot.json'
            )?.source as { content: string }
          ).content
        ) as Record<string, unknown>
      const participant = find(
        service.buildPlan(baseInput({ viewer: { role: 'tenant' } }))
      )
      const admin = find(
        service.buildPlan(baseInput({ viewer: { role: 'admin' } }))
      )
      expect(participant).toEqual({
        snapshotId: 'snap-1',
        snapshotCode: 'GOV-000001',
        version: 2,
        manifestHash: GOV_HASH,
      })
      expect(admin.components).toBeDefined()
      expect(
        service.buildPlan(baseInput({ viewer: { role: 'admin' } })).manifest
          .audience
      ).toBe('operator')
    })

    it('hides platform-fee invoices owed by the other party from a participant but not from operators', () => {
      const payments = [
        {
          paymentId: 'p-rent',
          type: 'rent',
          amount: 1,
          status: 'paid',
          payerRole: 'tenant',
        },
        {
          paymentId: 'p-fee-landlord',
          type: 'platform-fee',
          amount: 2,
          status: 'paid',
          payerRole: 'landlord',
        },
        {
          paymentId: 'p-fee-tenant',
          type: 'platform-fee',
          amount: 3,
          status: 'paid',
          payerRole: 'tenant',
        },
      ]
      const ids = (role: 'tenant' | 'landlord' | 'staff'): string[] => {
        const plan = service.buildPlan(
          baseInput({ payments, viewer: { role } })
        )
        const entry = plan.entries.find(
          e => e.path === 'evidence/payments.json'
        )
        return (
          JSON.parse((entry?.source as { content: string }).content) as Array<{
            paymentId: string
          }>
        ).map(p => p.paymentId)
      }
      expect(ids('tenant')).toEqual(['p-fee-tenant', 'p-rent'])
      expect(ids('landlord')).toEqual(['p-fee-landlord', 'p-rent'])
      expect(ids('staff')).toEqual(['p-fee-landlord', 'p-fee-tenant', 'p-rent'])
    })
  })

  describe('forbidden fields', () => {
    it('never lets national identifiers, names, credentials, signature bytes or unrelated attachments into any JSON entry', () => {
      const leaks = {
        tenantCccd: '079123456789',
        landlordCccd: '079987654321',
        tenantName: 'Nguyen Van A',
        landlordName: 'Tran Thi B',
        password: 'hunter2',
        apiToken: 'tok_secret',
        privateKey: '-----BEGIN PRIVATE KEY-----',
        signatureValue: 'SIGBYTES',
        signatureValueRef: 'gridfs://sig',
        attachments: ['passport.jpg'],
        certificatePem: 'PEMDATA',
      }
      const plan = service.buildPlan(
        baseInput({
          ledgerEvents: [
            { ...baseInput().ledgerEvents[0]!, ...leaks },
          ] as never,
          governance: { ...baseInput().governance!, ...leaks },
          deposit: {
            depositId: 'd-1',
            amount: 1,
            depositHash: HASH,
            status: 'paid',
            ...leaks,
          },
          payments: [
            {
              paymentId: 'p-1',
              type: 'rent',
              amount: 1,
              status: 'paid',
              ...leaks,
              nested: { tenantCccd: 'x', keep: 1 },
            },
          ],
          amendments: [
            { amendmentId: 'a-1', sequence: 1, contentHash: HASH, ...leaks },
          ],
          termination: {
            reasonCode: 'X',
            reasonHash: HASH,
            terminatedAt: '2026-12-01T00:00:00.000Z',
            ...leaks,
          },
          settlement: {
            settlementId: 's-1',
            status: 'paid',
            total: 1,
            statementHash: HASH,
            ...leaks,
            lines: [
              { kind: 'FIRST_RENT', amount: 1, tenantName: 'Nguyen Van A' },
            ],
          },
          handover: {
            settlementId: 's-1',
            revision: 1,
            handoverHash: HASH,
            completedAt: '2026-10-05T00:00:00.000Z',
            meterReadings: { electricity: 1 },
            keyCount: 3,
            notes: 'private note',
            ...leaks,
          },
          viewer: { role: 'admin' },
        })
      )
      const json = [...plan.orderedEntries()]
        .filter(e => e.source.type === 'json')
        .map(e => (e.source as { content: string }).content)
        .join('\n')
      for (const forbidden of [
        '079123456789',
        '079987654321',
        'Nguyen Van A',
        'Tran Thi B',
        'hunter2',
        'tok_secret',
        'PRIVATE KEY',
        'SIGBYTES',
        'gridfs://sig',
        'passport.jpg',
        'PEMDATA',
        'private note',
        'meterReadings',
        'keyCount',
      ]) {
        expect(json).not.toContain(forbidden)
      }
      // Allowlisted evidence is still there.
      expect(json).toContain('p-1')
      expect(json).toContain('s-1')
    })
  })

  describe('verification layers (database / projection / ledger)', () => {
    const report = (
      overrides: Partial<EvidencePackageInput>
    ): ReturnType<
      ContractEvidencePackageService['buildPlan']
    >['verification'] => service.buildPlan(baseInput(overrides)).verification

    it('reports verified on all three layers only when every layer matches', () => {
      expect(report({})).toEqual({
        database: { status: 'verified', reason: null },
        projection: { status: 'verified', reason: null },
        ledger: { status: 'verified', reason: null },
        endToEnd: true,
      })
    })

    it('reports the database layer as unavailable (never verified) when the stored bytes could not be hashed', () => {
      const verification = report({
        artifact: { ...baseInput().artifact!, computedHash: null },
      })
      expect(verification.database).toEqual({
        status: 'unavailable',
        reason: 'ARTIFACT_HASH_NOT_COMPUTED',
      })
      expect(verification.endToEnd).toBe(false)
    })

    it.each([
      ['verified', { expectedHash: HASH, projectedHash: HASH }],
      ['mismatch', { expectedHash: HASH, projectedHash: 'e'.repeat(64) }],
      ['unavailable', { expectedHash: HASH, projectedHash: null }],
      ['unavailable', { expectedHash: null, projectedHash: HASH }],
    ])('projection layer is %s for %j', (status, projection) => {
      const verification = report({ projection })
      expect(verification.projection.status).toBe(status)
      expect(verification.endToEnd).toBe(status === 'verified')
    })

    it.each([
      ['verified', 'verified'],
      ['mismatch', 'mismatch'],
      ['unavailable', 'unavailable'],
    ] as const)(
      'ledger layer passes %s through for live Fabric',
      (status, expected) => {
        const verification = report({
          ledger: { status, networkMode: 'fabric' },
        })
        expect(verification.ledger.status).toBe(expected)
        expect(verification.endToEnd).toBe(status === 'verified')
      }
    )

    it('never claims ledger verification in simulation, even if told verified', () => {
      const verification = report({
        ledger: { status: 'verified', networkMode: 'simulation' },
      })
      expect(verification.ledger).toEqual({
        status: 'unavailable',
        reason: 'FABRIC_SIMULATION_MODE',
      })
      expect(verification.endToEnd).toBe(false)
    })

    it('does not claim end-to-end verification when Fabric is unavailable but still generates the plan', () => {
      const plan = service.buildPlan(
        baseInput({ ledger: { status: 'unavailable', networkMode: 'fabric' } })
      )
      expect(plan.verification.endToEnd).toBe(false)
      const entry = plan.entries.find(
        e => e.path === 'verification-report.json'
      )
      const parsed = JSON.parse(
        (entry?.source as { content: string }).content
      ) as { endToEnd: boolean; ledger: { status: string } }
      expect(parsed).toMatchObject({
        endToEnd: false,
        ledger: { status: 'unavailable' },
      })
    })

    it('keeps the verification report free of generation metadata so its hash is stable', () => {
      const a = service.buildPlan(
        baseInput({ generatedAt: new Date('2026-01-01T00:00:00.000Z') })
      )
      const b = service.buildPlan(
        baseInput({ generatedAt: new Date('2027-01-01T00:00:00.000Z') })
      )
      const hashOf = (plan: typeof a): string | undefined =>
        plan.entries.find(e => e.path === 'verification-report.json')?.sha256
      expect(hashOf(a)).toBe(hashOf(b))
    })
  })

  describe('declared-size limits', () => {
    const limited = (
      values: Record<string, number>
    ): ContractEvidencePackageService =>
      new ContractEvidencePackageService({
        get: (key: string) => values[key.replace('evidencePackage.', '')],
      } as never)

    it('rejects with EVIDENCE_PACKAGE_TOO_LARGE naming the non-sensitive limit that was exceeded', () => {
      for (const [config, limit] of [
        [{ maxFiles: 2, maxBytes: 10_000_000 }, 'maxFiles'],
        [{ maxFiles: 50, maxBytes: 1000 }, 'maxBytes'],
      ] as const) {
        let error: unknown
        try {
          limited(config).buildPlan(baseInput())
        } catch (caught) {
          error = caught
        }
        expect((error as { getStatus: () => number }).getStatus()).toBe(413)
        expect(
          (error as { getResponse: () => unknown }).getResponse()
        ).toMatchObject({
          code: 'EVIDENCE_PACKAGE_TOO_LARGE',
          limit,
        })
      }
    })

    it('accepts a package at exactly the limits and uses defaults when unconfigured', () => {
      const plan = service.buildPlan(baseInput())
      const total = plan.entries.reduce((sum, e) => sum + e.byteLength, 0)
      expect(() =>
        limited({
          maxFiles: plan.entries.length + 1,
          maxBytes: total + plan.orderedEntries()[0]!.byteLength,
        }).buildPlan(baseInput())
      ).not.toThrow()
    })
  })
})
