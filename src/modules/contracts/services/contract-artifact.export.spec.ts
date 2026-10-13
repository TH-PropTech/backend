import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ObjectId } from 'mongodb'
import { Readable } from 'node:stream'
import { ContractArtifactService } from './contract-artifact.service'
import type { Contract } from '../schemas/contract.schema'

describe('ContractArtifactService.openCanonicalArtifactForExport (PROP-399 task 9.5)', () => {
  const contractId = new ObjectId()
  const artifactId = new ObjectId()
  const fileId = new ObjectId()
  const HASH = 'a'.repeat(64)

  function contract(overrides: Record<string, unknown> = {}): Contract {
    return {
      _id: contractId,
      contentLockedHash: HASH,
      contentLockedAt: new Date('2026-10-01T00:00:00.000Z'),
      artifactRef: {
        artifactId: artifactId.toHexString(),
        revision: 2,
        artifactHash: HASH,
        contentType: 'application/pdf',
        lockedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      ...overrides,
    } as unknown as Contract
  }

  function artifact(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      _id: artifactId,
      contractId: contractId.toHexString(),
      revision: 2,
      artifactHash: HASH,
      contentType: 'application/pdf',
      gridFsFileId: fileId,
      byteLength: 10,
      amendmentId: null,
      ...overrides,
    }
  }

  function build(options: {
    found?: Record<string, unknown> | null
    list?: Array<Record<string, unknown>>
    storage?: Record<string, unknown> | undefined
  }): {
    service: ContractArtifactService
    storage: { download: jest.Mock; openDownloadStream: jest.Mock }
  } {
    const storage = {
      download: jest.fn(),
      openDownloadStream: jest.fn(() => Promise.resolve(Readable.from(['x']))),
      ...(options.storage ?? {}),
    }
    const artifactRepository = {
      findOne: jest.fn().mockResolvedValue(options.found ?? null),
      find: jest.fn().mockResolvedValue(options.list ?? []),
    }
    const service = new ContractArtifactService(
      {} as never,
      artifactRepository as never,
      storage as never
    )
    return { service, storage }
  }

  it('returns the current artifact with a lazy stream opener and reads no bytes up front', async () => {
    const { service, storage } = build({ found: artifact() })
    const result = await service.openCanonicalArtifactForExport(contract())

    expect(result.recordedHash).toBe(HASH)
    expect(storage.openDownloadStream).not.toHaveBeenCalled()
    expect(storage.download).not.toHaveBeenCalled()
    await result.open()
    expect(storage.openDownloadStream).toHaveBeenCalledWith(fileId)
  })

  it('looks up an older canonical revision by contract and revision, ignoring amendment artifacts', async () => {
    const older = artifact({ revision: 1, artifactHash: 'b'.repeat(64) })
    const { service } = build({
      list: [artifact({ revision: 1, amendmentId: 'am-1' }), older],
    })
    const result = await service.openCanonicalArtifactForExport(contract(), 1)
    expect(result.artifact).toBe(older)
    expect(result.recordedHash).toBe('b'.repeat(64))
  })

  it('throws EVIDENCE_VERSION_NOT_FOUND for an unknown revision', async () => {
    const { service } = build({
      list: [artifact({ revision: 1, amendmentId: 'am-1' })],
    })
    const error = await service
      .openCanonicalArtifactForExport(contract(), 7)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotFoundException)
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'EVIDENCE_VERSION_NOT_FOUND',
    })
  })

  it('rejects an unlocked contract, a missing record and a superseded/inconsistent record', async () => {
    const unlocked = build({ found: artifact() })
    await expect(
      unlocked.service.openCanonicalArtifactForExport(
        contract({ artifactRef: null })
      )
    ).rejects.toBeInstanceOf(ConflictException)

    const missing = build({ found: null })
    await expect(
      missing.service.openCanonicalArtifactForExport(contract())
    ).rejects.toBeInstanceOf(NotFoundException)

    const superseded = build({
      found: artifact({ artifactHash: 'c'.repeat(64) }),
    })
    await expect(
      superseded.service.openCanonicalArtifactForExport(contract())
    ).rejects.toThrow('CONTRACT_ARTIFACT_SUPERSEDED')

    const foreign = build({
      found: artifact({ contractId: new ObjectId().toHexString() }),
    })
    await expect(
      foreign.service.openCanonicalArtifactForExport(contract())
    ).rejects.toThrow('CONTRACT_ARTIFACT_SUPERSEDED')
  })

  it('reports storage unavailable when the storage has no streaming reader', async () => {
    const { service } = build({
      found: artifact(),
      storage: { openDownloadStream: undefined },
    })
    await expect(
      service.openCanonicalArtifactForExport(contract())
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
