import { createHash } from 'node:crypto'
import forge from 'node-forge'
import PDFDocument from 'pdfkit'
import type { Contract } from '../schemas/contract.schema'
import { ContractDocumentProjector } from '../legal/contract-document.projector'
import { buildReviewedLeaseTemplateSeed } from '../legal/lease-template.seed'
import { renderContractPdf } from '../utils/contract-pdf.renderer'
import { embedPadesSignature, preparePadesSigning } from './pades.util'
import {
  buildSignableBase,
  countSignedRanges,
  hasSignatureBoxMetadata,
  hasSignatureFields,
} from './signature-fields'

jest.setTimeout(60_000)

const meta = {
  reason: 'Ký hợp đồng thuê căn hộ',
  location: 'Việt Nam',
  contactInfo: 'support@th-proptech.vn',
  creator: 'TH-PropTech',
}

async function renderCanonical(): Promise<Buffer> {
  const contract = {
    contractCode: 'HD-TEST-001',
    propertyTitle: 'Căn hộ test',
    propertyAddress: '213, Xã Lộc Điền, Thành phố Huế',
    propertyArea: 90,
    landlordName: 'Nguyễn Văn Chủ',
    tenantName: 'Trần Thị Khách',
    monthlyRent: 12_500_000,
    deposit: 25_000_000,
    durationMonths: 12,
    paymentDay: 5,
    latePenaltyRate: 10,
    terminationNoticeDays: 30,
    startDate: new Date('2026-10-11'),
    endDate: new Date('2027-10-11'),
    contentLockedHash: 'a'.repeat(64),
    contentLockedAt: new Date('2026-10-11T04:00:00Z'),
    contentRevision: 1,
  } as unknown as Contract
  const seed = buildReviewedLeaseTemplateSeed('PRIVATE_CIVIL_APARTMENT_LEASE')
  const document = ContractDocumentProjector.projectDocument(contract, {
    clauses: seed.clauses,
    annexDefinitions: seed.annexDefinitions,
    citationIds: seed.citationIds,
    legalProfile: seed.legalProfile,
    schemaVersion: seed.schemaVersion,
    version: 2,
    templateKey: 'VN_INDIVIDUAL_RESIDENTIAL_LEASE',
  } as never)
  return renderContractPdf(contract, document)
}

function identity(): { key: forge.pki.rsa.PrivateKey; pem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 1_000_000)
  cert.validity.notAfter = new Date(Date.now() + 1_000_000_000)
  const attrs = [{ name: 'commonName', value: 'Signer' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { key: keys.privateKey, pem: forge.pki.certificateToPem(cert) }
}

function signHash(key: forge.pki.rsa.PrivateKey, hashHex: string): string {
  const md = {
    algorithm: 'sha256',
    digest: (): forge.util.ByteStringBuffer =>
      forge.util.createBuffer(forge.util.hexToBytes(hashHex)),
  }
  return forge.util.encode64(key.sign(md as unknown as forge.md.MessageDigest))
}

function rangeDigest(pdf: Buffer, index: number): string {
  const ranges = [
    ...pdf
      .toString('latin1')
      .matchAll(/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g),
  ]
  const match = ranges[index]
  if (!match) throw new Error('range missing')
  const [b, c, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return createHash('sha256')
    .update(pdf.subarray(0, b))
    .update(pdf.subarray(c, c + d))
    .digest('hex')
}

describe('visible signature fields', () => {
  it('records the signature box positions in the canonical pdf', async () => {
    const canonical = await renderCanonical()
    expect(hasSignatureBoxMetadata(canonical)).toBe(true)
    expect(hasSignatureFields(canonical)).toBe(false)
  })

  it('builds a base with two unsigned fields and signs both parties in sequence keeping the first valid', async () => {
    const canonical = await renderCanonical()
    const base = await buildSignableBase(canonical)
    expect(base).not.toBeNull()
    expect(hasSignatureFields(base as Buffer)).toBe(true)
    const { key, pem } = identity()

    const first = preparePadesSigning(
      base as Buffer,
      meta,
      pem,
      [],
      new Date('2026-10-11T04:30:00Z'),
      {
        role: 'landlord',
        signerName: 'Nguyễn Văn Chủ',
        certificateSerial: 'S1',
      }
    )
    const afterFirst = embedPadesSignature(
      first,
      signHash(key, first.signedAttrsDigestHex),
      pem
    )
    const second = preparePadesSigning(
      afterFirst,
      meta,
      pem,
      [],
      new Date('2026-10-11T05:00:00Z'),
      { role: 'tenant', signerName: 'Trần Thị Khách', certificateSerial: 'S2' }
    )
    const afterSecond = embedPadesSignature(
      second,
      signHash(key, second.signedAttrsDigestHex),
      pem
    )

    expect(countSignedRanges(afterSecond)).toBe(2)
    // Chuỗi tiếng Việt trong từ điển chữ ký phải là UTF-16BE có BOM, không phải byte rác.
    expect(afterSecond.toString('latin1')).toContain('/Reason <FEFF')
    expect(rangeDigest(afterSecond, 0)).toBe(first.contentDigestHex)
    expect(rangeDigest(afterSecond, 1)).toBe(second.contentDigestHex)
    // Phần đã có không bị sửa byte nào khi nối thêm chữ ký thứ hai.
    expect(afterSecond.subarray(0, afterFirst.length).equals(afterFirst)).toBe(
      true
    )
  })

  it('returns null for a pdf without signature box metadata so the invisible fallback is used', async () => {
    const plain = await new Promise<Buffer>(resolve => {
      const doc = new PDFDocument()
      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.text('x')
      doc.end()
    })

    await expect(buildSignableBase(plain)).resolves.toBeNull()
  })

  it('never mutates the canonical bytes', async () => {
    const canonical = await renderCanonical()
    const before = createHash('sha256').update(canonical).digest('hex')

    await buildSignableBase(canonical)

    expect(createHash('sha256').update(canonical).digest('hex')).toBe(before)
  })
})
