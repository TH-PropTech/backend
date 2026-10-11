import { createHash } from 'node:crypto'
import { plainAddPlaceholder } from '@signpdf/placeholder-plain'
import { SUBFILTER_ETSI_CADES_DETACHED, findByteRange } from '@signpdf/utils'
import forge from 'node-forge'

/** Thông tin chữ ký theo quy định NEAC (hiển thị trong thuộc tính chữ ký của PDF). */
export type PadesSignatureMeta = {
  reason: string
  location: string
  contactInfo: string
  /** Đơn vị tạo chữ ký (creator/name trong từ điển chữ ký). */
  creator: string
}

export type PreparedPades = {
  /** PDF đã có placeholder và /ByteRange thật, sẵn sàng nhúng CMS. */
  pdf: Buffer
  /** SHA-256 (hex) của vùng byte-range, đưa vào messageDigest của CMS. */
  contentDigestHex: string
  /** Hex SHA-256 của signedAttributes DER — đây là giá trị gửi SmartCA để ký. */
  signedAttrsDigestHex: string
  signingTime: Date
}

const SIGNATURE_BYTES = 12288

type Gap = { start: number; end: number }

/** Thêm placeholder chữ ký (ETSI.CAdES.detached) vào PDF canonical; không đổi bytes gốc. */
export function addSignaturePlaceholder(
  pdf: Buffer,
  meta: PadesSignatureMeta,
  signingTime: Date = new Date()
): Buffer {
  return Buffer.from(
    plainAddPlaceholder({
      pdfBuffer: pdf,
      reason: meta.reason,
      contactInfo: meta.contactInfo,
      name: meta.creator,
      location: meta.location,
      signingTime,
      signatureLength: SIGNATURE_BYTES,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    })
  )
}

function locateContentsGap(pdf: Buffer): Gap {
  const { byteRangePlaceholderPosition } = findByteRange(pdf)
  const from = byteRangePlaceholderPosition ?? pdf.indexOf('/ByteRange')
  const contents = pdf.indexOf('/Contents', from)
  const start = pdf.indexOf('<', contents)
  const end = pdf.indexOf('>', start) + 1
  if (contents < 0 || start < 0 || end <= start) {
    throw new Error('PADES_CONTENTS_NOT_FOUND')
  }
  return { start, end }
}

function writeByteRange(pdf: Buffer, gap: Gap): Buffer {
  const { byteRangePlaceholder } = findByteRange(pdf)
  if (!byteRangePlaceholder) throw new Error('PADES_BYTERANGE_NOT_FOUND')
  let next = `/ByteRange [0 ${gap.start} ${gap.end} ${pdf.length - gap.end}]`
  if (next.length > byteRangePlaceholder.length) {
    throw new Error('PADES_BYTERANGE_TOO_LONG')
  }
  next = next.padEnd(byteRangePlaceholder.length, ' ')
  const at = pdf.indexOf(byteRangePlaceholder)
  return Buffer.concat([
    pdf.subarray(0, at),
    Buffer.from(next, 'latin1'),
    pdf.subarray(at + byteRangePlaceholder.length),
  ])
}

function hashRange(pdf: Buffer, gap: Gap): string {
  return createHash('sha256')
    .update(pdf.subarray(0, gap.start))
    .update(pdf.subarray(gap.end))
    .digest('hex')
}

type SignerKey = { sign: (md: forge.md.MessageDigest) => string }

function buildCms(input: {
  contentDigestHex: string
  signingTime: Date
  signerPem: string
  chainPem: string[]
  key: SignerKey
}): forge.pkcs7.PkcsSignedData {
  const p7 = forge.pkcs7.createSignedData()
  const signer = forge.pki.certificateFromPem(input.signerPem)
  p7.content = forge.util.createBuffer('')
  p7.addCertificate(signer)
  for (const pem of input.chainPem) {
    p7.addCertificate(forge.pki.certificateFromPem(pem))
  }
  p7.addSigner({
    key: input.key as unknown as forge.pki.rsa.PrivateKey,
    certificate: signer,
    digestAlgorithm: forge.pki.oids['sha256'] as string,
    authenticatedAttributes: [
      {
        type: forge.pki.oids['contentType'],
        value: forge.pki.oids['data'],
      },
      {
        type: forge.pki.oids['messageDigest'] as string,
        value: forge.util.createBuffer(
          forge.util.hexToBytes(input.contentDigestHex)
        ) as unknown as string,
      },
      {
        type: forge.pki.oids['signingTime'] as string,
        value: input.signingTime as unknown as string,
      },
    ],
  })
  p7.sign({ detached: true })
  return p7
}

/**
 * Bước 1: tạo placeholder, chốt /ByteRange, tính digest nội dung và digest của
 * signedAttributes. `signedAttrsDigestHex` là giá trị SmartCA phải ký.
 */
export function preparePadesSigning(
  canonicalPdf: Buffer,
  meta: PadesSignatureMeta,
  signerPem: string,
  chainPem: string[] = [],
  signingTime: Date = new Date()
): PreparedPades {
  const withPlaceholder = addSignaturePlaceholder(
    canonicalPdf,
    meta,
    signingTime
  )
  const gap = locateContentsGap(withPlaceholder)
  const pdf = writeByteRange(withPlaceholder, gap)
  const contentDigestHex = hashRange(pdf, gap)

  let captured = ''
  buildCms({
    contentDigestHex,
    signingTime,
    signerPem,
    chainPem,
    key: {
      sign: md => {
        captured = md.digest().toHex()
        return ''
      },
    },
  })
  if (!captured) throw new Error('PADES_SIGNED_ATTRS_DIGEST_FAILED')
  return { pdf, contentDigestHex, signedAttrsDigestHex: captured, signingTime }
}

/**
 * Bước 2: dựng CMS detached từ chữ ký SmartCA (base64, RSA PKCS#1 v1.5 trên
 * signedAttrsDigest) rồi nhúng vào /Contents. Không đổi /ByteRange.
 */
export function embedPadesSignature(
  prepared: PreparedPades,
  signatureBase64: string,
  signerPem: string,
  chainPem: string[] = []
): Buffer {
  const signatureBytes = Buffer.from(signatureBase64, 'base64').toString(
    'binary'
  )
  const p7 = buildCms({
    contentDigestHex: prepared.contentDigestHex,
    signingTime: prepared.signingTime,
    signerPem,
    chainPem,
    key: { sign: () => signatureBytes },
  })
  const cmsHex = Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary')
    .toString('hex')
    .toUpperCase()

  const gap = locateContentsGap(prepared.pdf)
  const reserved = gap.end - gap.start - 2
  if (cmsHex.length > reserved) throw new Error('PADES_SIGNATURE_TOO_LARGE')
  const body = Buffer.from(cmsHex.padEnd(reserved, '0'), 'ascii')
  return Buffer.concat([
    prepared.pdf.subarray(0, gap.start + 1),
    body,
    prepared.pdf.subarray(gap.end - 1),
  ])
}
