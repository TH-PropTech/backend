import * as path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Contract } from './schemas/contract.schema'
import type { ContractDocumentViewDto } from './dto/contract-view.dto'

export const CONTRACT_PDF_RENDERER_VERSION = 'th-proptech-pdf-v1'

export const LEGAL_BASIS_LINES: readonly string[] = [
  'Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;',
  'Căn cứ Luật Nhà ở số 27/2023/QH15 ngày 27/11/2023;',
  'Căn cứ Luật Kinh doanh bất động sản số 29/2023/QH15 ngày 28/11/2023;',
  'Căn cứ Luật Giao dịch điện tử số 20/2023/QH15 ngày 22/6/2023;',
  'Căn cứ nhu cầu và khả năng thực tế của các bên.',
]

const PAGE_MARGIN = 56
const FONT_REGULAR = 'Body'
const FONT_BOLD = 'Body-Bold'

/** DejaVu Sans phủ đủ ký tự tiếng Việt (PDFKit chỉ nhúng được font TrueType có glyph tương ứng). */
function resolveFontDir(): string {
  const packageJson = require.resolve('dejavu-fonts-ttf/package.json')
  return path.join(path.dirname(packageJson), 'ttf')
}

function formatDate(value?: Date | string | null): string {
  if (!value) return 'Chưa xác định'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Chưa xác định'
    : date.toLocaleDateString('vi-VN')
}

function partyLines(
  role: string,
  name: string | null,
  cccd: string | null,
  address: string | null,
  phone: string | null
): string[] {
  return [
    role,
    `Họ và tên: ${name || '—'}`,
    `Số CCCD: ${cccd || '—'}`,
    `Địa chỉ: ${address || '—'}`,
    `Điện thoại: ${phone || '—'}`,
  ]
}

/** Địa điểm lập hợp đồng: tỉnh/thành ở cuối địa chỉ căn hộ. */
export function resolveSigningPlace(propertyAddress: string | null): string {
  const parts = (propertyAddress ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] ?? 'Việt Nam'
}

/**
 * Dựng bản PDF chuẩn của hợp đồng từ cấu trúc văn bản đã được chiếu từ mẫu pháp lý
 * (`ContractDocumentProjector`). Bản PDF này là artifact duy nhất được ký bằng SmartCA.
 */
export function renderContractPdf(
  contract: Contract,
  document: ContractDocumentViewDto
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const fontDir = resolveFontDir()
    const pdf = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `Hợp đồng thuê căn hộ ${contract.contractCode}`,
        Author: 'TH-PropTech',
        Producer: CONTRACT_PDF_RENDERER_VERSION,
        CreationDate: contract.contentLockedAt
          ? new Date(contract.contentLockedAt)
          : new Date(0),
      },
    })
    pdf.registerFont(FONT_REGULAR, path.join(fontDir, 'DejaVuSans.ttf'))
    pdf.registerFont(FONT_BOLD, path.join(fontDir, 'DejaVuSans-Bold.ttf'))

    const chunks: Buffer[] = []
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    try {
      const contentWidth = pdf.page.width - PAGE_MARGIN * 2

      pdf
        .font(FONT_BOLD)
        .fontSize(11)
        .text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { align: 'center' })
        .text('Độc lập - Tự do - Hạnh phúc', { align: 'center' })
        .moveDown(1.2)
        .fontSize(16)
        .text('HỢP ĐỒNG THUÊ CĂN HỘ', { align: 'center' })
        .font(FONT_REGULAR)
        .fontSize(10)
        .moveDown(0.3)
        .text(`Số: ${contract.contractCode}`, { align: 'center' })
        .text(`Mẫu: ${document.templateVersion}`, { align: 'center' })
        .moveDown(1)

      pdf.font(FONT_REGULAR).fontSize(10)
      for (const line of LEGAL_BASIS_LINES)
        pdf.text(line, { width: contentWidth })
      pdf.moveDown(0.8)

      pdf
        .font(FONT_REGULAR)
        .fontSize(10.5)
        .text(
          `Hôm nay, ngày ${formatDate(contract.contentLockedAt ?? contract.startDate)}, tại ${resolveSigningPlace(contract.propertyAddress)}, các bên dưới đây cùng thỏa thuận ký kết hợp đồng thuê căn hộ với các điều khoản sau:`,
          { align: 'justify' }
        )
        .moveDown(0.8)

      const parties: Array<
        [string, string | null, string | null, string | null, string | null]
      > = [
        [
          'BÊN CHO THUÊ (Bên A)',
          contract.landlordName,
          contract.landlordCccd,
          contract.landlordAddress,
          contract.landlordPhone ?? null,
        ],
        [
          'BÊN THUÊ (Bên B)',
          contract.tenantName,
          contract.tenantCccd,
          contract.tenantAddress,
          contract.tenantPhone ?? null,
        ],
      ]
      for (const [role, name, cccd, address, phone] of parties) {
        const [heading, ...rest] = partyLines(role, name, cccd, address, phone)
        pdf
          .font(FONT_BOLD)
          .fontSize(10.5)
          .text(heading ?? role)
        pdf.font(FONT_REGULAR).fontSize(10.5)
        for (const line of rest) pdf.text(line)
        pdf.moveDown(0.6)
      }
      pdf.moveDown(0.4)
      pdf.font(FONT_BOLD).fontSize(10.5).text('THÔNG TIN CĂN HỘ')
      pdf.font(FONT_REGULAR).fontSize(10.5)
      pdf.text(`Căn hộ: ${contract.propertyTitle || '—'}`)
      pdf.text(`Địa chỉ: ${contract.propertyAddress || '—'}`)
      pdf.text(
        `Diện tích: ${contract.propertyArea ? `${contract.propertyArea} m²` : '—'}`
      )
      pdf.text(
        `Giấy chứng nhận quyền sở hữu/sử dụng: ${contract.propertyOwnershipCertificate || '—'}`
      )
      pdf.moveDown(1)

      for (const section of document.sections) {
        pdf
          .font(FONT_BOLD)
          .fontSize(11)
          .text(`Điều ${section.number}. ${section.title}`, {
            width: contentWidth,
          })
          .moveDown(0.3)
        pdf
          .font(FONT_REGULAR)
          .fontSize(10.5)
          .text(section.content, { align: 'justify', width: contentWidth })
          .moveDown(0.8)
      }

      if ((document.supplementaryClauses?.length ?? 0) > 0) {
        pdf
          .font(FONT_BOLD)
          .fontSize(11)
          .text('Điều khoản bổ sung')
          .moveDown(0.3)
        for (const clause of document.supplementaryClauses ?? []) {
          pdf.font(FONT_BOLD).fontSize(10.5).text(clause.title)
          pdf
            .font(FONT_REGULAR)
            .fontSize(10.5)
            .text(clause.content, { align: 'justify', width: contentWidth })
            .moveDown(0.6)
        }
      }

      if (document.annexes.length > 0) {
        pdf.font(FONT_BOLD).fontSize(11).text('Phụ lục kèm theo').moveDown(0.3)
        pdf.font(FONT_REGULAR).fontSize(10.5)
        for (const annex of document.annexes) {
          pdf.text(`• ${annex.title}${annex.required ? ' (bắt buộc)' : ''}`)
        }
        pdf.moveDown(1)
      }

      // Khối chữ ký: giữ nguyên trên cùng một trang.
      if (pdf.y > pdf.page.height - PAGE_MARGIN - 190) pdf.addPage()
      const signTop = pdf.y
      const colWidth = contentWidth / 2
      pdf
        .font(FONT_REGULAR)
        .fontSize(10)
        .text(
          `Hợp đồng được lập tại ${resolveSigningPlace(contract.propertyAddress)}, ngày ${formatDate(contract.contentLockedAt ?? contract.startDate)}, ký kết bằng chữ ký số; các bên xác nhận đã đọc, hiểu rõ và có đủ thẩm quyền giao kết hợp đồng này.`,
          PAGE_MARGIN,
          signTop,
          { width: contentWidth, align: 'justify' }
        )
      const blockTop = pdf.y + 12
      pdf.font(FONT_BOLD).fontSize(10.5)
      pdf.text('ĐẠI DIỆN BÊN CHO THUÊ', PAGE_MARGIN, blockTop, {
        width: colWidth,
        align: 'center',
      })
      pdf.text('ĐẠI DIỆN BÊN THUÊ', PAGE_MARGIN + colWidth, blockTop, {
        width: colWidth,
        align: 'center',
      })
      pdf.font(FONT_REGULAR).fontSize(9)
      pdf.text('(Ký số bằng VNPT SmartCA)', PAGE_MARGIN, blockTop + 16, {
        width: colWidth,
        align: 'center',
      })
      pdf.text(
        '(Ký số bằng VNPT SmartCA)',
        PAGE_MARGIN + colWidth,
        blockTop + 16,
        { width: colWidth, align: 'center' }
      )
      pdf.fontSize(10.5)
      pdf.text(contract.landlordName ?? '', PAGE_MARGIN, blockTop + 80, {
        width: colWidth,
        align: 'center',
      })
      pdf.text(
        contract.tenantName ?? '',
        PAGE_MARGIN + colWidth,
        blockTop + 80,
        {
          width: colWidth,
          align: 'center',
        }
      )

      // Chân trang: mã băm nội dung đã khóa + số trang.
      const range = pdf.bufferedPageRange()
      for (let index = 0; index < range.count; index += 1) {
        pdf.switchToPage(range.start + index)
        pdf.page.margins.bottom = 0
        pdf
          .font(FONT_REGULAR)
          .fontSize(8)
          .fillColor('#666666')
          .text(
            `${contract.contractCode} · Hash nội dung: ${(document.lockedHash ?? '').slice(0, 24)}… · Trang ${index + 1}/${range.count}`,
            PAGE_MARGIN,
            pdf.page.height - 36,
            { width: contentWidth, align: 'center', lineBreak: false }
          )
          .fillColor('#000000')
      }
      pdf.end()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
