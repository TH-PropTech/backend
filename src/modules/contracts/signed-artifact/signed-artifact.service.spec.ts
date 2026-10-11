import { createHash } from 'node:crypto'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import forge from 'node-forge'
import { ObjectId } from 'mongodb'
import PDFDocument from 'pdfkit'
import {
  SignedArtifactService,
  isPadesEnabled,
} from './signed-artifact.service'

function makePdf(): Promise<Buffer> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ compress: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.text('Hop dong')
    doc.end()
  })
}

function makeIdentity(): {
  privateKey: forge.pki.rsa.PrivateKey
  certPem: string
} {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86_400_000)
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attrs = [{ name: 'commonName', value: 'Signer' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    privateKey: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
  }
}

function signHash(
  privateKey: forge.pki.rsa.PrivateKey,
  hashHex: string
): string {
  const md = {
    algorithm: 'sha256',
    digest: (): forge.util.ByteStringBuffer =>
      forge.util.createBuffer(forge.util.hexToBytes(hashHex)),
  }
  return forge.util.encode64(
    privateKey.sign(md as unknown as forge.md.MessageDigest)
  )
}

describe('SignedArtifactService', () => {
  const contractId = new ObjectId()
  const canonicalHash = 'c'.repeat(64)
  const contract = {
    _id: contractId,
    tenantId: 'tenant-1',
    landlordId: 'landlord-1',
  }

  async function build(): Promise<{
    service: SignedArtifactService
    files: Map<string, Buffer>
    rows: Record<string, unknown>[]
    canonical: Buffer
  }> {
    const canonical = await makePdf()
    const files = new Map<string, Buffer>()
    const rows: Record<string, unknown>[] = []
    const storage = {
      upload: jest.fn((bytes: Buffer) => {
        const id = new ObjectId()
        files.set(id.toHexString(), bytes)
        return Promise.resolve(id)
      }),
      download: jest.fn((id: ObjectId) =>
        Promise.resolve(files.get(id.toHexString()) as Buffer)
      ),
    }
    const repository = {
      create: jest.fn((value: Record<string, unknown>) => ({
        _id: new ObjectId(),
        ...value,
      })),
      save: jest.fn((value: Record<string, unknown>) => {
        if (!rows.includes(value)) rows.push(value)
        return Promise.resolve(value)
      }),
      find: jest.fn(() =>
        Promise.resolve(rows.filter(row => row['status'] === 'ready'))
      ),
      findOne: jest.fn(({ where }: { where: { _id: ObjectId } }) =>
        Promise.resolve(
          rows.find(
            row =>
              (row['_id'] as ObjectId).toHexString() === where._id.toHexString()
          ) ?? null
        )
      ),
    }
    const contractRepository = {
      findOne: jest.fn().mockResolvedValue(contract),
    }
    const artifactService = {
      resolveCanonicalArtifact: jest.fn().mockResolvedValue({
        bytes: canonical,
        reference: { artifactHash: canonicalHash },
      }),
    }
    const service = new SignedArtifactService(
      repository as never,
      contractRepository as never,
      storage,
      artifactService as never
    )
    return { service, files, rows, canonical }
  }

  it('prepares, finalizes and serves a signed copy without touching the canonical bytes', async () => {
    const { service, canonical } = await build()
    const before = createHash('sha256').update(canonical).digest('hex')
    const { privateKey, certPem } = makeIdentity()

    const prepared = await service.prepare({
      contract: contract as never,
      signerId: 'tenant-1',
      signerRole: 'tenant',
      signerPem: certPem,
      chainPem: [],
    })
    const ok = await service.finalize(
      prepared.id,
      signHash(privateKey, prepared.signedAttrsDigest)
    )

    expect(ok).toBe(true)
    const download = await service.downloadForActor(
      contractId.toHexString(),
      'tenant-1',
      false
    )
    expect(download.bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(download.revision).toBe(1)
    expect(download.canonicalHash).toBe(canonicalHash)
    expect(download.sha256).toBe(
      createHash('sha256').update(download.bytes).digest('hex')
    )
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(before)
  })

  it('keeps the first signature valid when the second party signs the next revision', async () => {
    const { service } = await build()
    const { privateKey, certPem } = makeIdentity()

    const first = await service.prepare({
      contract: contract as never,
      signerId: 'landlord-1',
      signerRole: 'landlord',
      signerPem: certPem,
      chainPem: [],
    })
    await service.finalize(
      first.id,
      signHash(privateKey, first.signedAttrsDigest)
    )
    const second = await service.prepare({
      contract: contract as never,
      signerId: 'tenant-1',
      signerRole: 'tenant',
      signerPem: certPem,
      chainPem: [],
    })
    await service.finalize(
      second.id,
      signHash(privateKey, second.signedAttrsDigest)
    )

    const latest = await service.downloadForActor(
      contractId.toHexString(),
      'landlord-1',
      false
    )
    expect(latest.revision).toBe(2)
    const ranges = [
      ...latest.bytes
        .toString('latin1')
        .matchAll(/\/ByteRange \[\d+ \d+ \d+ \d+\s*\]/g),
    ]
    expect(ranges).toHaveLength(2)
  })

  it('records a failed signed copy when the signature does not fit, keeping retry possible', async () => {
    const { service, rows } = await build()
    const { certPem } = makeIdentity()
    const prepared = await service.prepare({
      contract: contract as never,
      signerId: 'tenant-1',
      signerRole: 'tenant',
      signerPem: certPem,
      chainPem: [],
    })

    const ok = await service.finalize(prepared.id, 'A'.repeat(40_000))

    expect(ok).toBe(false)
    expect(rows[0]).toMatchObject({
      status: 'failed',
      errorCode: 'PADES_SIGNATURE_TOO_LARGE',
    })
    await expect(
      service.download(contractId.toHexString())
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('refuses downloads from non participants and returns 404 when nothing is signed', async () => {
    const { service } = await build()

    await expect(
      service.downloadForActor(contractId.toHexString(), 'stranger', false)
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      service.downloadForActor(contractId.toHexString(), 'tenant-1', false)
    ).rejects.toBeInstanceOf(NotFoundException)
    await expect(
      service.downloadForActor(contractId.toHexString(), 'staff-1', true)
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('isPadesEnabled', () => {
  it('is off by default and never on for the mock provider', () => {
    expect(isPadesEnabled({})).toBe(false)
    expect(
      isPadesEnabled({ SMARTCA_PADES_ENABLED: 'true', SMARTCA_ENV: 'mock' })
    ).toBe(false)
    expect(
      isPadesEnabled({ SMARTCA_PADES_ENABLED: 'true', SMARTCA_ENV: 'test' })
    ).toBe(true)
  })
})
