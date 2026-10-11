import { createHash } from 'node:crypto'
import forge from 'node-forge'
import PDFDocument from 'pdfkit'
import {
  embedPadesSignature,
  preparePadesSigning,
  type PadesSignatureMeta,
} from './pades.util'

const meta: PadesSignatureMeta = {
  reason: 'Ký hợp đồng thuê căn hộ',
  location: 'TP. Hồ Chí Minh',
  contactInfo: 'support@th-proptech.vn',
  creator: 'TH-PropTech',
}

function makePdf(): Promise<Buffer> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ compress: false })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.text('Hop dong thue can ho')
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
  const attrs = [{ name: 'commonName', value: 'Test Signer' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return {
    privateKey: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
  }
}

/** Giả lập SmartCA: ký RSA PKCS#1 v1.5 trên hash đã cho. */
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

describe('PAdES signing helpers', () => {
  it('embeds a CMS whose signature verifies and whose digest matches the byte range', async () => {
    const canonical = await makePdf()
    const { privateKey, certPem } = makeIdentity()

    const prepared = preparePadesSigning(canonical, meta, certPem)
    const signed = embedPadesSignature(
      prepared,
      signHash(privateKey, prepared.signedAttrsDigestHex),
      certPem
    )

    const text = signed.toString('latin1')
    const match = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/.exec(text)
    if (!match) throw new Error('ByteRange missing')
    const [a, b, c, d] = match.slice(1, 5).map(Number) as [
      number,
      number,
      number,
      number,
    ]
    expect(a).toBe(0)
    expect(c + d).toBe(signed.length)

    // Digest vùng byte-range của file cuối phải khớp messageDigest đã ký.
    const finalDigest = createHash('sha256')
      .update(signed.subarray(0, b))
      .update(signed.subarray(c))
      .digest('hex')
    expect(finalDigest).toBe(prepared.contentDigestHex)

    // Trích CMS từ /Contents và kiểm chữ ký trên signedAttributes.
    const hex = text.slice(b + 1, c - 1).replace(/0+$/, '')
    const der = forge.util.hexToBytes(hex.length % 2 ? `${hex}0` : hex)
    const msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der))
    const signerInfo = (
      msg as unknown as {
        rawCapture: {
          signature: string
          authenticatedAttributes: forge.asn1.Asn1[]
        }
      }
    ).rawCapture
    const attrsSet = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      signerInfo.authenticatedAttributes
    )
    const attrsDigest = forge.md.sha256
      .create()
      .update(forge.asn1.toDer(attrsSet).getBytes())
      .digest()
    expect(attrsDigest.toHex()).toBe(prepared.signedAttrsDigestHex)
    const cert = forge.pki.certificateFromPem(certPem)
    expect(
      (cert.publicKey as forge.pki.rsa.PublicKey).verify(
        attrsDigest.getBytes(),
        signerInfo.signature
      )
    ).toBe(true)
  })

  it('does not modify the canonical bytes passed in', async () => {
    const canonical = await makePdf()
    const before = createHash('sha256').update(canonical).digest('hex')
    const { certPem } = makeIdentity()

    preparePadesSigning(canonical, meta, certPem)

    expect(createHash('sha256').update(canonical).digest('hex')).toBe(before)
  })

  it('writes reason, location, contact info and creator into the signature dictionary', async () => {
    const canonical = await makePdf()
    const { certPem } = makeIdentity()

    const { pdf } = preparePadesSigning(canonical, meta, certPem)
    const text = pdf.toString('latin1')

    expect(text).toContain('/Reason')
    expect(text).toContain('/Location')
    expect(text).toContain('/ContactInfo')
    expect(text).toContain('ETSI.CAdES.detached')
  })
})
