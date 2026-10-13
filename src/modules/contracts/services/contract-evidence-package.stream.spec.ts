import { createHash } from 'node:crypto'
import { PassThrough, Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ConflictException, UnprocessableEntityException } from '@nestjs/common'
import {
  ContractEvidencePackageService,
  EvidencePackageAbortedError,
  type EvidencePackageInput,
  type EvidencePackagePlan,
} from './contract-evidence-package.service'
import { readZip } from '../utils/zip-reader.fixtures'

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function collect(): { sink: Writable; chunks: Buffer[]; bytes: () => Buffer } {
  const chunks: Buffer[] = []
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(chunk)
      callback()
    },
  })
  return { sink, chunks, bytes: () => Buffer.concat(chunks) }
}

function planFor(
  pdf: { byteLength: number; sha256: string },
  service: ContractEvidencePackageService,
  extra: Partial<EvidencePackageInput> = {}
): EvidencePackagePlan {
  return service.buildPlan({
    contract: { id: 'contract-1', contractCode: 'HD-1', status: 'active' },
    viewer: { role: 'admin' },
    artifact: {
      artifactId: 'artifact-1',
      revision: 2,
      contentType: 'application/pdf',
      byteLength: pdf.byteLength,
      recordedHash: pdf.sha256,
      computedHash: pdf.sha256,
    },
    ledgerEvents: [
      {
        eventType: 'contract.activated',
        aggregateType: 'contract',
        status: 'confirmed',
        networkMode: 'fabric',
        txId: 'tx-1',
        blockNumber: 3,
        recordedAt: '2026-10-01T00:00:00.000Z',
        payloadHash: 'a'.repeat(64),
        dependsOn: null,
      },
    ],
    governance: null,
    projection: { expectedHash: pdf.sha256, projectedHash: pdf.sha256 },
    ledger: { status: 'verified', networkMode: 'fabric' },
    generatedAt: new Date('2026-10-02T00:00:00.000Z'),
    ...extra,
  })
}

describe('ContractEvidencePackageService ZIP streaming (PROP-399 tasks 9.4/9.5)', () => {
  const service = new ContractEvidencePackageService()
  const smallPdf = Buffer.from(
    '%PDF-1.7 canonical signed contract bytes '.repeat(50)
  )
  const smallMeta = { byteLength: smallPdf.length, sha256: sha256(smallPdf) }

  describe('real archiver round trip (CommonJS runtime + ESM-only archiver)', () => {
    it('writes a readable ZIP whose entries match the plan in D8 order, hash and byte length', async () => {
      const plan = planFor(smallMeta, service)
      const { sink, bytes } = collect()

      const result = await service.writeZip(plan, sink, {
        openArtifact: () =>
          Promise.resolve(
            Readable.from([smallPdf.subarray(0, 100), smallPdf.subarray(100)])
          ),
      })

      const zip = readZip(bytes())
      expect(zip.map(entry => entry.name)).toEqual(
        plan.orderedEntries().map(e => e.path)
      )
      expect(result.entries).toBe(zip.length)
      expect(result.bytesWritten).toBe(bytes().length)

      for (const entry of plan.entries) {
        const found = zip.find(item => item.name === entry.path)
        expect(found).toBeDefined()
        expect(found?.data.length).toBe(entry.byteLength)
        expect(sha256(found!.data)).toBe(entry.sha256)
      }
      const pdf = zip.find(entry => entry.name === 'contract/contract-r2.pdf')
      expect(pdf?.data.equals(smallPdf)).toBe(true)

      const manifest = JSON.parse(
        zip.find(entry => entry.name === 'manifest.json')!.data.toString('utf8')
      ) as {
        packageHash: string
        entries: Array<{ path: string; sha256: string }>
      }
      expect(manifest.packageHash).toBe(plan.packageHash)
      expect(manifest.entries.map(e => e.path)).toEqual(
        plan.entries.map(e => e.path)
      )
    })

    it('supports a package with only the mandatory entries and an empty-ish ledger history', async () => {
      const plan = planFor(smallMeta, service, { ledgerEvents: [] })
      const { sink, bytes } = collect()
      await service.writeZip(plan, sink, {
        openArtifact: () => Promise.resolve(Readable.from([smallPdf])),
      })
      expect(readZip(bytes()).map(e => e.name)).toEqual([
        'manifest.json',
        'verification-report.json',
        'contract/contract-r2.pdf',
      ])
    })
  })

  describe('bounded memory', () => {
    it('streams a large artifact with backpressure instead of loading it into memory', async () => {
      const CHUNK = 64 * 1024
      const CHUNKS = 256 // 16 MiB
      const hash = createHash('sha256')
      for (let i = 0; i < CHUNKS; i += 1)
        hash.update(Buffer.alloc(CHUNK, i % 251))
      const meta = { byteLength: CHUNK * CHUNKS, sha256: hash.digest('hex') }
      const big = new ContractEvidencePackageService({
        get: (key: string) =>
          key === 'evidencePackage.maxBytes' ? 64 * 1024 * 1024 : undefined,
      } as never)
      const plan = planFor(meta, big)

      let produced = 0
      let consumed = 0
      let maxAhead = 0
      let next = 0
      const source = new Readable({
        highWaterMark: CHUNK,
        read(): void {
          if (next >= CHUNKS) {
            this.push(null)
            return
          }
          produced += CHUNK
          maxAhead = Math.max(maxAhead, produced - consumed)
          this.push(Buffer.alloc(CHUNK, next % 251))
          next += 1
        },
      })
      const slowSink = new Writable({
        highWaterMark: 16 * 1024,
        write(chunk: Buffer, _encoding, callback): void {
          consumed += chunk.length
          setImmediate(callback)
        },
      })

      await big.writeZip(plan, slowSink, {
        openArtifact: () => Promise.resolve(source),
      })

      expect(produced).toBe(CHUNK * CHUNKS)
      // Stored (not deflated) PDF bytes pass through, so the producer can run at most a bounded window ahead.
      expect(maxAhead).toBeLessThan(CHUNK * CHUNKS * 0.25)
    }, 60000)
  })

  describe('failure behaviour and cleanup', () => {
    it('rejects with EVIDENCE_PACKAGE_INCOMPLETE and writes nothing when the canonical PDF cannot be opened', async () => {
      const plan = planFor(smallMeta, service)
      const { sink, chunks } = collect()
      const error = await service
        .writeZip(plan, sink, {
          openArtifact: () =>
            Promise.reject(new Error('GridFS FileNotFound secret-detail')),
        })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(UnprocessableEntityException)
      expect(
        (error as UnprocessableEntityException).getResponse()
      ).toMatchObject({
        code: 'EVIDENCE_PACKAGE_INCOMPLETE',
      })
      expect(
        JSON.stringify((error as UnprocessableEntityException).getResponse())
      ).not.toContain('secret-detail')
      expect(chunks).toHaveLength(0)
    })

    it('aborts with EVIDENCE_ARTIFACT_MISMATCH and cleans up when the bytes differ from the recorded hash while streaming', async () => {
      const plan = planFor(smallMeta, service)
      const tampered = Buffer.from(smallPdf)
      tampered[10] = tampered[10]! ^ 0xff
      const source = Readable.from([tampered])
      const { sink } = collect()
      const error = await service
        .writeZip(plan, sink, { openArtifact: () => Promise.resolve(source) })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'EVIDENCE_ARTIFACT_MISMATCH',
      })
      expect(source.destroyed).toBe(true)
      expect(sink.destroyed).toBe(true)
    })

    it('aborts when the stored artifact is longer than its recorded byte length', async () => {
      const plan = planFor(smallMeta, service)
      const longer = Buffer.concat([smallPdf, Buffer.from('EXTRA')])
      const { sink } = collect()
      await expect(
        service.writeZip(plan, sink, {
          openArtifact: () => Promise.resolve(Readable.from([longer])),
        })
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('stops at the configured byte limit while streaming and reports EVIDENCE_PACKAGE_TOO_LARGE', async () => {
      const ample = new ContractEvidencePackageService({
        get: (key: string) =>
          key === 'evidencePackage.maxBytes' ? 10_000_000 : undefined,
      } as never)
      const plan = planFor(smallMeta, ample)
      const tight = new ContractEvidencePackageService({
        get: (key: string) =>
          key === 'evidencePackage.maxBytes' ? 1500 : undefined,
      } as never)
      const source = Readable.from([smallPdf])
      const { sink } = collect()
      const error = await tight
        .writeZip(plan, sink, { openArtifact: () => Promise.resolve(source) })
        .catch((e: unknown) => e)
      expect(
        (error as { getResponse: () => unknown }).getResponse()
      ).toMatchObject({
        code: 'EVIDENCE_PACKAGE_TOO_LARGE',
        limit: 'maxBytes',
      })
      expect(source.destroyed).toBe(true)
    })

    it('reports a client disconnect as an abort and releases every open stream', async () => {
      const plan = planFor(smallMeta, service)
      const source = new PassThrough()
      const sink = new PassThrough()
      let aborted: unknown
      const pending = service
        .writeZip(plan, sink, { openArtifact: () => Promise.resolve(source) })
        .catch((e: unknown) => {
          aborted = e
        })

      source.write(smallPdf.subarray(0, 200))
      await new Promise(resolve => setImmediate(resolve))
      sink.destroy() // client went away mid-stream
      await pending

      expect(aborted).toBeInstanceOf(EvidencePackageAbortedError)
      expect((aborted as EvidencePackageAbortedError).reason).toBe(
        'client-abort'
      )
      expect(source.destroyed).toBe(true)
    })

    it('reports an artifact stream error as a stream-error abort without leaking details', async () => {
      const plan = planFor(smallMeta, service)
      const source = new PassThrough()
      const { sink } = collect()
      const pending = service
        .writeZip(plan, sink, { openArtifact: () => Promise.resolve(source) })
        .catch((e: unknown) => e)
      source.write(smallPdf.subarray(0, 100))
      await new Promise(resolve => setImmediate(resolve))
      source.destroy(new Error('socket reset secret-host-10.0.0.9'))
      const error = await pending

      expect(error).toBeInstanceOf(EvidencePackageAbortedError)
      expect((error as EvidencePackageAbortedError).reason).toBe('stream-error')
      expect((error as Error).message).not.toContain('secret-host')
      expect(sink.destroyed).toBe(true)
    })

    it('honours an AbortSignal as a client abort', async () => {
      const plan = planFor(smallMeta, service)
      const source = new PassThrough()
      const { sink } = collect()
      const controller = new AbortController()
      const pending = service
        .writeZip(plan, sink, {
          openArtifact: () => Promise.resolve(source),
          signal: controller.signal,
        })
        .catch((e: unknown) => e)
      source.write(smallPdf.subarray(0, 100))
      await new Promise(resolve => setImmediate(resolve))
      controller.abort()
      const error = await pending
      expect(error).toBeInstanceOf(EvidencePackageAbortedError)
      expect(source.destroyed).toBe(true)
    })

    it('adds no listeners of its own to the destination (only Node pipeline bookkeeping remains)', async () => {
      const plan = planFor(smallMeta, service)
      const baseline = new Writable({ write: (_c, _e, cb): void => cb() })
      await pipeline(Readable.from([Buffer.from('x')]), baseline)
      const { sink } = collect()
      await service.writeZip(plan, sink, {
        openArtifact: () => Promise.resolve(Readable.from([smallPdf])),
      })
      for (const event of ['close', 'error', 'finish', 'unpipe'] as const) {
        expect(sink.listenerCount(event)).toBeLessThanOrEqual(
          baseline.listenerCount(event) + 1
        )
      }
      expect(sink.writableFinished).toBe(true)
    })
  })

  describe('hashArtifactStream (pre-export integrity pass)', () => {
    it('hashes a stream without buffering and reports its length', async () => {
      const result = await service.hashArtifactStream(
        Readable.from([smallPdf.subarray(0, 7), smallPdf.subarray(7)]),
        smallPdf.length
      )
      expect(result).toEqual({
        sha256: sha256(smallPdf),
        byteLength: smallPdf.length,
      })
    })

    it('stops early and reports a size mismatch instead of reading an oversized file to the end', async () => {
      const stream = Readable.from([smallPdf, smallPdf, smallPdf])
      const result = await service.hashArtifactStream(stream, smallPdf.length)
      expect(result.sha256).toBeNull()
      expect(result.byteLength).toBeGreaterThan(smallPdf.length)
      expect(stream.destroyed).toBe(true)
    })

    it('maps a read failure to EVIDENCE_PACKAGE_INCOMPLETE', async () => {
      const stream = new Readable({ read(): void {} })
      const pending = service
        .hashArtifactStream(stream, 10)
        .catch((e: unknown) => e)
      stream.destroy(new Error('FileNotFound'))
      const error = await pending
      expect(error).toBeInstanceOf(UnprocessableEntityException)
    })
  })
})
