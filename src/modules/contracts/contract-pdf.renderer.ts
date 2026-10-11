import * as path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Contract } from './schemas/contract.schema'
import type { ContractDocumentViewDto } from './dto/contract-view.dto'

export const CONTRACT_PDF_RENDERER_VERSION = 'th-proptech-pdf-v1'

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
  address: string | null
): string[] {
  return [
    role,
    `Họ và tên: ${name || '—'}`,
    `Số CCCD: ${cccd || '—'}`,
    `Địa chỉ: ${address || '—'}`,
  ]
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

      pdf
        .font(FONT_REGULAR)
        .fontSize(10.5)
        .text(
          `Hôm nay, ngày ${formatDate(contract.startDate)}, các bên dưới đây cùng thỏa thuận ký kết hợp đồng thuê căn hộ với các điều khoản sau:`,
          { align: 'justify' }
        )
        .moveDown(0.8)

      const parties: Array<
        [string, string | null, string | null, string | null]
      > = [
        [
          'BÊN CHO THUÊ (Bên A)',
          contract.landlordName,
          contract.landlordCccd,
          contract.landlordAddress,
        ],
        [
          'BÊN THUÊ (Bên B)',
          contract.tenantName,
          contract.tenantCccd,
          contract.tenantAddress,
        ],
      ]
      for (const [role, name, cccd, address] of parties) {
        const [heading, ...rest] = partyLines(role, name, cccd, address)
        pdf
          .font(FONT_BOLD)
          .fontSize(10.5)
          .text(heading ?? role)
        pdf.font(FONT_REGULAR).fontSize(10.5)
        for (const line of rest) pdf.text(line)
        pdf.moveDown(0.6)
      }
      pdf.moveDown(0.4)

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
      if (pdf.y > pdf.page.height - PAGE_MARGIN - 130) pdf.addPage()
      const signTop = pdf.y
      const colWidth = contentWidth / 2
      pdf.font(FONT_BOLD).fontSize(10.5)
      pdf.text('ĐẠI DIỆN BÊN CHO THUÊ', PAGE_MARGIN, signTop, {
        width: colWidth,
        align: 'center',
      })
      pdf.text('ĐẠI DIỆN BÊN THUÊ', PAGE_MARGIN + colWidth, signTop, {
        width: colWidth,
        align: 'center',
      })
      pdf.font(FONT_REGULAR).fontSize(9)
      pdf.text('(Ký số bằng VNPT SmartCA)', PAGE_MARGIN, signTop + 16, {
        width: colWidth,
        align: 'center',
      })
      pdf.text(
        '(Ký số bằng VNPT SmartCA)',
        PAGE_MARGIN + colWidth,
        signTop + 16,
        { width: colWidth, align: 'center' }
      )
      pdf.fontSize(10.5)
      pdf.text(contract.landlordName ?? '', PAGE_MARGIN, signTop + 80, {
        width: colWidth,
        align: 'center',
      })
      pdf.text(
        contract.tenantName ?? '',
        PAGE_MARGIN + colWidth,
        signTop + 80,
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
