import * as fs from 'node:fs'
import * as path from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFRef, PDFString } from 'pdf-lib'
import type { PadesSignatureMeta } from './pades.util'

/**
 * Chữ ký hiển thị cho bản PDF đã ký.
 *
 * Bản đã ký là artifact riêng: lần đầu dựng "bản nền" từ canonical PDF, thêm hai trường chữ ký (bên A, bên B)
 * đặt đúng ô chữ ký đã vẽ sẵn. Mỗi lần có người ký chỉ nối thêm (incremental update) từ điển chữ ký + khung
 * hiển thị "Đã xác thực SmartCA", nên chữ ký của bên trước vẫn hợp lệ.
 */

export type SignatureRole = 'landlord' | 'tenant'

import { SIGNATURE_BOXES_INFO_KEY } from '../utils/contract-pdf.renderer'
const FIELD_NAMES: Record<SignatureRole, string> = {
  landlord: 'SigLandlord',
  tenant: 'SigTenant',
}
const PLACEHOLDER_HEX_BYTES = 12288

type BoxRect = { x: number; y: number; w: number; h: number }
type SignatureBoxes = {
  page: number
  height: number
  landlord: BoxRect
  tenant: BoxRect
}

function fontDir(): string {
  return path.join(__dirname, '..', 'fonts')
}

let cachedFonts: { regular: Buffer; bold: Buffer } | null = null
function loadFonts(): { regular: Buffer; bold: Buffer } {
  cachedFonts ??= {
    regular: fs.readFileSync(path.join(fontDir(), 'Tinos-Regular.ttf')),
    bold: fs.readFileSync(path.join(fontDir(), 'Tinos-Bold.ttf')),
  }
  return cachedFonts
}

type TextMetrics = {
  /** Chuỗi hex glyph (Identity-H) để đưa vào toán tử Tj. */
  hex: (text: string) => string
  width: (text: string, size: number) => number
}

function metricsFor(fontBytes: Buffer): TextMetrics {
  const font = fontkit.create(fontBytes) as unknown as {
    unitsPerEm: number
    layout: (text: string) => {
      glyphs: Array<{ id: number; advanceWidth: number }>
    }
  }
  return {
    hex: text =>
      font
        .layout(text)
        .glyphs.map(glyph => glyph.id.toString(16).padStart(4, '0'))
        .join(''),
    width: (text, size) =>
      (font
        .layout(text)
        .glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) /
        font.unitsPerEm) *
      size,
  }
}

function parseBoxes(pdf: PDFDocument): SignatureBoxes | null {
  const infoRef = pdf.context.trailerInfo.Info
  const info = infoRef ? pdf.context.lookup(infoRef) : undefined
  const dict = info && 'lookup' in info ? (info as never) : undefined
  if (!dict) return null
  const value = (
    dict as {
      lookup: (name: PDFName) => { decodeText?: () => string } | undefined
    }
  ).lookup(PDFName.of(SIGNATURE_BOXES_INFO_KEY))
  const text = value?.decodeText?.()
  if (!text) return null
  try {
    return JSON.parse(text) as SignatureBoxes
  } catch {
    return null
  }
}

/** Bản nền đã có trường chữ ký hay chưa (bản đã ký trước đó, hoặc canonical v4 có metadata ô chữ ký). */
export function hasSignatureFields(pdf: Buffer): boolean {
  const text = pdf.toString('latin1')
  return (
    text.includes(`(${FIELD_NAMES.landlord})`) &&
    text.includes(`(${FIELD_NAMES.tenant})`)
  )
}

export function hasSignatureBoxMetadata(pdf: Buffer): boolean {
  return pdf.toString('latin1').includes(`/${SIGNATURE_BOXES_INFO_KEY}`)
}

/** Nội dung stream khung "đang chờ ký" (nét đứt) cho một ô. */
function pendingStream(
  box: { w: number; h: number },
  regular: TextMetrics
): string {
  const label = 'Chờ ký số'
  const size = 9
  const x = (box.w - regular.width(label, size)) / 2
  return [
    'q 0.6 G 0.8 w [3 2] 0 d',
    `0.5 0.5 ${box.w - 1} ${box.h - 1} re S Q`,
    `BT /F1 ${size} Tf 0.55 g 1 0 0 1 ${x.toFixed(2)} ${(box.h / 2 - 3).toFixed(2)} Tm <${regular.hex(label)}> Tj ET`,
  ].join('\n')
}

/**
 * Dựng bản nền: thêm hai trường chữ ký chưa ký vào trang cuối (đúng ô chữ ký), mỗi trường có khung "chờ ký".
 * Trả về null nếu canonical không có metadata ô chữ ký (bản cũ) — khi đó dùng chữ ký ẩn như trước.
 */
export async function buildSignableBase(
  canonical: Buffer
): Promise<Buffer | null> {
  const pdf = await PDFDocument.load(canonical, { updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const boxes = parseBoxes(pdf)
  if (!boxes) return null

  const fonts = loadFonts()
  const regularFont = await pdf.embedFont(fonts.regular, { subset: false })
  const boldFont = await pdf.embedFont(fonts.bold, { subset: false })
  const regular = metricsFor(fonts.regular)
  const page = pdf.getPage(boxes.page)
  const pageRef = pdf.context.getObjectRef(page.node) as PDFRef

  const widgetRefs: PDFRef[] = []
  for (const role of ['landlord', 'tenant'] as const) {
    const box = boxes[role]
    const stream = pdf.context.stream(
      pendingStream({ w: box.w, h: box.h }, regular),
      {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, box.w, box.h],
        Resources: { Font: { F1: regularFont.ref } },
      }
    )
    const streamRef = pdf.context.register(stream)
    const widget = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of(FIELD_NAMES[role]),
      Rect: [
        box.x,
        boxes.height - box.y - box.h,
        box.x + box.w,
        boxes.height - box.y,
      ],
      F: 4,
      P: pageRef,
      AP: { N: streamRef },
      // Khóa riêng của TH-PropTech: font dùng lại khi dựng khung "đã ký".
      THFont: regularFont.ref,
      THFontBold: boldFont.ref,
    })
    const widgetRef = pdf.context.register(widget)
    page.node.addAnnot(widgetRef)
    widgetRefs.push(widgetRef)
  }
  pdf.catalog.set(
    PDFName.of('AcroForm'),
    pdf.context.obj({
      Fields: widgetRefs,
      SigFlags: 3,
    })
  )
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

// ───────────────────────── chữ ký nối thêm (incremental) ─────────────────────────

export type VisibleSignatureInput = {
  role: SignatureRole
  signerName: string
  certificateSerial: string
  signingTime: Date
  meta: PadesSignatureMeta
}

type TrailerInfo = {
  size: number
  root: string
  info: string | null
  id: string | null
  prevXref: number
}

function readTrailer(pdf: Buffer): TrailerInfo {
  const text = pdf.toString('latin1')
  const start = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/g)].pop()
  if (!start) throw new Error('PADES_PDF_STRUCTURE_UNSUPPORTED')
  const trailerAt = text.lastIndexOf('trailer')
  if (trailerAt < 0) throw new Error('PADES_PDF_STRUCTURE_UNSUPPORTED')
  const trailer = text.slice(trailerAt, start.index)
  const size = /\/Size\s+(\d+)/.exec(trailer)?.[1]
  const root = /\/Root\s+(\d+\s+\d+\s+R)/.exec(trailer)?.[1]
  if (!size || !root) throw new Error('PADES_PDF_STRUCTURE_UNSUPPORTED')
  return {
    size: Number(size),
    root,
    info: /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer)?.[1] ?? null,
    id: /\/ID\s*(\[[^\]]*\])/.exec(trailer)?.[1] ?? null,
    prevXref: Number(start[1]),
  }
}

/** Chuỗi PDF dạng hex UTF-16BE (an toàn cho tiếng Việt). */
function pdfText(value: string): string {
  const bytes = Buffer.from(
    String.fromCharCode(0xfeff) + value,
    'utf16le'
  ).swap16()
  return `<${bytes.toString('hex').toUpperCase()}>`
}

function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `(D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z)`
}

function findLastObject(
  text: string,
  marker: string
): { num: number; body: string } | null {
  let found: { num: number; body: string } | null = null
  const pattern = /(\d+)\s+0\s+obj\s*([\s\S]*?)endobj/g
  for (const match of text.matchAll(pattern)) {
    if (match[2]?.includes(marker)) {
      found = { num: Number(match[1]), body: match[2] }
    }
  }
  return found
}

function fit(text: string, max: number, size: number, m: TextMetrics): string {
  if (m.width(text, size) <= max) return text
  let cut = text
  while (cut.length > 1 && m.width(`${cut}…`, size) > max)
    cut = cut.slice(0, -1)
  return `${cut}…`
}

function formatStampTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  return parts
}

function stampStream(
  box: { w: number; h: number },
  input: VisibleSignatureInput,
  regular: TextMetrics,
  bold: TextMetrics
): string {
  const pad = 5
  const inner = box.w - pad * 2
  const lines: Array<{
    text: string
    size: number
    font: 'F1' | 'F2'
    color: string
  }> = [
    {
      text: 'ĐÃ XÁC THỰC SMARTCA',
      size: 8.6,
      font: 'F2',
      color: '0.05 0.45 0.2',
    },
    {
      text: fit(input.signerName, inner, 8.6, bold),
      size: 8.6,
      font: 'F2',
      color: '0 g',
    },
    {
      text: fit(`Serial: ${input.certificateSerial}`, inner, 6.6, regular),
      size: 6.6,
      font: 'F1',
      color: '0.25 g',
    },
    {
      text: `Ký ngày ${formatStampTime(input.signingTime)}`,
      size: 6.6,
      font: 'F1',
      color: '0.25 g',
    },
  ]
  const parts = [
    'q 0.05 0.45 0.2 RG 1 w',
    `0.5 0.5 ${box.w - 1} ${box.h - 1} re S Q`,
    'q 0.94 0.98 0.95 rg',
    `1.5 1.5 ${box.w - 3} ${box.h - 3} re f Q`,
  ]
  let y = box.h - 15
  for (const line of lines) {
    const metrics = line.font === 'F2' ? bold : regular
    const x = (box.w - metrics.width(line.text, line.size)) / 2
    parts.push(
      `BT /${line.font} ${line.size} Tf ${line.color.includes('g') ? line.color : `${line.color} rg`} 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${metrics.hex(line.text)}> Tj ET`
    )
    y -= line === lines[0] ? 15 : line.size > 7 ? 14 : 11
  }
  return parts.join('\n')
}

/**
 * Nối thêm từ điển chữ ký (còn placeholder /ByteRange, /Contents) và gắn vào trường chữ ký của `role`,
 * kèm khung "Đã xác thực SmartCA" hiển thị đúng ô chữ ký. Không sửa byte nào đã có.
 */
export function appendVisibleSignature(
  pdf: Buffer,
  input: VisibleSignatureInput
): Buffer {
  const text = pdf.toString('latin1')
  const widget = findLastObject(text, `(${FIELD_NAMES[input.role]})`)
  if (!widget) throw new Error('PADES_SIGNATURE_FIELD_NOT_FOUND')
  const trailer = readTrailer(pdf)

  const rect =
    /\/Rect\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(
      widget.body
    )
  const fontRef = /\/THFont\s+(\d+)\s+0\s+R/.exec(widget.body)?.[1]
  const boldRef = /\/THFontBold\s+(\d+)\s+0\s+R/.exec(widget.body)?.[1]
  if (!rect || !fontRef || !boldRef) {
    throw new Error('PADES_SIGNATURE_FIELD_INVALID')
  }
  const box = {
    w: Number(rect[3]) - Number(rect[1]),
    h: Number(rect[4]) - Number(rect[2]),
  }

  const fonts = loadFonts()
  const content = stampStream(
    box,
    input,
    metricsFor(fonts.regular),
    metricsFor(fonts.bold)
  )
  const stampNum = trailer.size
  const sigNum = trailer.size + 1
  const contentLatin1 = Buffer.from(content, 'latin1')

  const stampObj = Buffer.from(
    `${stampNum} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 ${box.w} ${box.h}] /Resources << /Font << /F1 ${fontRef} 0 R /F2 ${boldRef} 0 R >> >> /Length ${contentLatin1.length} >>\nstream\n`,
    'latin1'
  )
  const stampTail = Buffer.from('\nendstream\nendobj\n', 'latin1')

  const sigObj = Buffer.from(
    `${sigNum} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 /********** /********** /**********] /Contents <${'0'.repeat(PLACEHOLDER_HEX_BYTES * 2)}> /Reason ${pdfText(input.meta.reason)} /Location ${pdfText(input.meta.location)} /ContactInfo ${pdfText(input.meta.contactInfo)} /Name ${pdfText(input.meta.creator)} /M ${pdfDate(input.signingTime)} >>\nendobj\n`,
    'latin1'
  )

  const widgetBody = widget.body
    .replace(/\/AP\s*<<[^>]*>>/, '')
    .replace(/\/V\s+\d+\s+0\s+R/, '')
    .trimEnd()
  const closing = widgetBody.lastIndexOf('>>')
  const updatedWidget = `${widget.num} 0 obj\n${widgetBody.slice(0, closing)}/V ${sigNum} 0 R /AP << /N ${stampNum} 0 R >> >>\nendobj\n`

  const prefix = Buffer.from('\n', 'latin1')
  const parts: Buffer[] = [pdf, prefix]
  const offsets = new Map<number, number>()
  let length = pdf.length + prefix.length
  const push = (num: number | null, ...buffers: Buffer[]): void => {
    if (num !== null) offsets.set(num, length)
    for (const buffer of buffers) {
      parts.push(buffer)
      length += buffer.length
    }
  }
  push(stampNum, stampObj, contentLatin1, stampTail)
  push(sigNum, sigObj)
  push(widget.num, Buffer.from(updatedWidget, 'latin1'))

  const xrefOffset = length
  const entries = [...offsets.entries()].sort((a, b) => a[0] - b[0])
  let xref = 'xref\n'
  let i = 0
  while (i < entries.length) {
    let j = i
    while (
      j + 1 < entries.length &&
      entries[j + 1]![0] === entries[j]![0] + 1
    ) {
      j += 1
    }
    xref += `${entries[i]![0]} ${j - i + 1}\n`
    for (let k = i; k <= j; k += 1) {
      xref += `${String(entries[k]![1]).padStart(10, '0')} 00000 n \n`
    }
    i = j + 1
  }
  xref += `trailer\n<< /Size ${trailer.size + 2} /Root ${trailer.root}${trailer.info ? ` /Info ${trailer.info}` : ''}${trailer.id ? ` /ID ${trailer.id}` : ''} /Prev ${trailer.prevXref} >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  push(null, Buffer.from(xref, 'latin1'))
  return Buffer.concat(parts)
}

/** Dùng cho kiểm tra: số chữ ký đã có /ByteRange thật trong PDF. */
export function countSignedRanges(pdf: Buffer): number {
  return (
    pdf
      .toString('latin1')
      .match(/\/ByteRange\s*\[\s*0\s+\d+\s+\d+\s+\d+\s*\]/g) ?? []
  ).length
}
