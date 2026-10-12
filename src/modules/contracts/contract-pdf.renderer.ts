import * as path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Contract } from './schemas/contract.schema'
import type { ContractDocumentViewDto } from './dto/contract-view.dto'
import { resolveEffectiveCommercial } from './commercial/resolve-effective-commercial'
import {
  drawLabelRows,
  drawSignatureBox,
  drawSummaryBox,
  drawTable,
  type BlockTheme,
} from './contract-pdf.blocks'
import { buildRentSchedule } from './contract-payment-schedule'
import { vndInWords } from './legal/vnd-in-words'

export const CONTRACT_PDF_RENDERER_VERSION = 'th-proptech-pdf-v3'

export const LEGAL_BASIS_LINES: readonly string[] = [
  'Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015;',
  'Căn cứ Luật Nhà ở số 27/2023/QH15 ngày 27/11/2023;',
  'Căn cứ Luật Kinh doanh bất động sản số 29/2023/QH15 ngày 28/11/2023;',
  'Căn cứ Luật Giao dịch điện tử số 20/2023/QH15 ngày 22/6/2023;',
  'Căn cứ nhu cầu và khả năng thực tế của các bên.',
]

const MARGIN_TOP = 57
const MARGIN_BOTTOM = 57
const MARGIN_LEFT = 85
const MARGIN_RIGHT = 57
const BODY_SIZE = 12
const LINE_GAP = 2.5
const FONT_REGULAR = 'Body'
const FONT_BOLD = 'Body-Bold'
const FONT_ITALIC = 'Body-Italic'

/**
 * Tinos (OFL) tương thích số đo Times New Roman và phủ đủ ký tự tiếng Việt; được nhúng kèm mã nguồn
 * để bản PDF giống nhau trên mọi máy chủ (không phụ thuộc font hệ điều hành).
 */
function resolveFontDir(): string {
  return path.join(__dirname, 'fonts')
}

/** Các thành phần ngày theo múi giờ Việt Nam để ngày in trên hợp đồng không lệch theo máy chủ. */
function vnDateParts(
  value?: Date | string | null
): { day: number; month: number; year: number } | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date)
  const pick = (type: string): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0)
  return { day: pick('day'), month: pick('month'), year: pick('year') }
}

function formatDate(value?: Date | string | null): string {
  const parts = vnDateParts(value)
  if (!parts) return 'Chưa xác định'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`
}

/** "ngày 11 tháng 10 năm 2026" theo thể thức văn bản hành chính. */
function formatLongDate(value?: Date | string | null): string {
  const parts = vnDateParts(value)
  if (!parts) return 'Chưa xác định'
  return `ngày ${parts.day} tháng ${parts.month} năm ${parts.year}`
}

function formatMoney(amount: number | null | undefined): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount ?? 0)} VNĐ`
}

function moneyWithWords(amount: number | null | undefined): string {
  const words = vndInWords(amount)
  return words
    ? `${formatMoney(amount)} (bằng chữ: ${words})`
    : formatMoney(amount)
}

/** Thông tin chưa có khi chốt hợp đồng: nói rõ thay vì để một dấu gạch khó hiểu. */
const PENDING_VALUE = '(chưa cập nhật)'

/** Địa điểm lập hợp đồng: tỉnh/thành ở cuối địa chỉ căn hộ. */
export function resolveSigningPlace(propertyAddress: string | null): string {
  const parts = (propertyAddress ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] ?? 'Việt Nam'
}

type TextStyle = {
  font?: string
  size?: number
  align?: 'left' | 'center' | 'right' | 'justify'
  indent?: number
  after?: number
  color?: string
}

/**
 * Dựng bản PDF chuẩn của hợp đồng từ cấu trúc văn bản đã được chiếu từ mẫu pháp lý
 * (`ContractDocumentProjector`). Bản PDF này là artifact duy nhất được ký bằng SmartCA.
 * Trình bày theo văn bản hành chính: font Tinos (tương thích Times New Roman), cỡ 12,
 * lề trái 3 cm, các lề còn lại 2 cm.
 */
export function renderContractPdf(
  contract: Contract,
  document: ContractDocumentViewDto
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const fontDir = resolveFontDir()
    const pdf = new PDFDocument({
      size: 'A4',
      margins: {
        top: MARGIN_TOP,
        bottom: MARGIN_BOTTOM,
        left: MARGIN_LEFT,
        right: MARGIN_RIGHT,
      },
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
    pdf.registerFont(FONT_REGULAR, path.join(fontDir, 'Tinos-Regular.ttf'))
    pdf.registerFont(FONT_BOLD, path.join(fontDir, 'Tinos-Bold.ttf'))
    pdf.registerFont(FONT_ITALIC, path.join(fontDir, 'Tinos-Italic.ttf'))

    const chunks: Buffer[] = []
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk))
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)

    try {
      const contentWidth = pdf.page.width - MARGIN_LEFT - MARGIN_RIGHT
      const place = resolveSigningPlace(contract.propertyAddress)
      const signedDate = formatDate(
        contract.contentLockedAt ?? contract.startDate
      )

      const theme: BlockTheme = {
        left: MARGIN_LEFT,
        width: contentWidth,
        bottom: MARGIN_BOTTOM,
        regular: FONT_REGULAR,
        bold: FONT_BOLD,
        italic: FONT_ITALIC,
        bodySize: BODY_SIZE,
        accent: '#7A2E1D',
        soft: '#F7F1EC',
        line: '#D9C7BC',
      }
      const commercial = resolveEffectiveCommercial(contract)

      /** Mỗi đoạn luôn đặt lại x để không bị lệch lề sau đoạn thụt vào. */
      const paragraph = (text: string, style: TextStyle = {}): void => {
        const indent = style.indent ?? 0
        pdf
          .font(style.font ?? FONT_REGULAR)
          .fontSize(style.size ?? BODY_SIZE)
          .fillColor(style.color ?? '#000000')
          .text(text, MARGIN_LEFT + indent, pdf.y, {
            width: contentWidth - indent,
            align: style.align ?? 'justify',
            lineGap: LINE_GAP,
          })
        if (style.after) pdf.moveDown(style.after)
      }
      /** Nội dung điều khoản: mỗi dòng là một đoạn; dòng bắt đầu bằng khoảng trắng là mục con (a, b, c...). */
      const clauseBody = (content: string): void => {
        for (const rawLine of content.split('\n')) {
          if (!rawLine.trim()) continue
          const isSubItem = /^\s{2,}/.test(rawLine)
          paragraph(rawLine.trim(), { indent: isSubItem ? 22 : 0 })
        }
      }

      // Quốc hiệu, tiêu ngữ
      paragraph('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', {
        font: FONT_BOLD,
        align: 'center',
      })
      paragraph('Độc lập - Tự do - Hạnh phúc', {
        font: FONT_BOLD,
        size: BODY_SIZE + 1,
        align: 'center',
      })
      const ruleY = pdf.y + 1
      pdf
        .moveTo(MARGIN_LEFT + contentWidth / 2 - 70, ruleY)
        .lineTo(MARGIN_LEFT + contentWidth / 2 + 70, ruleY)
        .lineWidth(0.7)
        .stroke('#000000')
      pdf.moveDown(1.2)

      paragraph('HỢP ĐỒNG THUÊ CĂN HỘ', {
        font: FONT_BOLD,
        size: 16,
        align: 'center',
      })
      paragraph(`Số: ${contract.contractCode}`, { align: 'center' })
      paragraph(
        `${place}, ${formatLongDate(contract.contentLockedAt ?? contract.startDate)}`,
        { font: FONT_ITALIC, align: 'center' }
      )
      paragraph(`(Mẫu: ${document.templateVersion})`, {
        font: FONT_ITALIC,
        size: BODY_SIZE - 1,
        align: 'center',
        after: 0.8,
      })

      for (const line of LEGAL_BASIS_LINES) {
        paragraph(line, { font: FONT_ITALIC, align: 'left' })
      }
      pdf.moveDown(0.6)

      paragraph(`Hôm nay, ngày ${signedDate}, tại ${place}, chúng tôi gồm:`, {
        after: 0.5,
      })

      const partyRows = (input: {
        name: string | null
        cccd: string | null
        issued?: string | null
        birthDate?: string | null
        address: string | null
        phone: string | null
      }): Array<{ label: string; value: string; emphasis?: boolean }> => [
        {
          label: 'Họ và tên:',
          value: input.name || PENDING_VALUE,
          emphasis: true,
        },
        ...(input.birthDate
          ? [{ label: 'Ngày sinh:', value: input.birthDate }]
          : []),
        {
          label: 'Số CCCD:',
          value: input.cccd
            ? `${input.cccd}${input.issued ? `, ${input.issued}` : ''}`
            : PENDING_VALUE,
        },
        {
          label: 'Địa chỉ thường trú:',
          value: input.address || PENDING_VALUE,
        },
        { label: 'Điện thoại:', value: input.phone || PENDING_VALUE },
      ]
      paragraph('BÊN CHO THUÊ (sau đây gọi là Bên A)', {
        font: FONT_BOLD,
        align: 'left',
      })
      drawLabelRows(
        pdf,
        theme,
        partyRows({
          name: contract.landlordName,
          cccd: contract.landlordCccd,
          issued: contract.landlordIdIssued ?? null,
          birthDate: contract.landlordBirthDate ?? null,
          address: contract.landlordAddress,
          phone: contract.landlordPhone ?? null,
        }),
        { x: MARGIN_LEFT + 14, width: contentWidth - 14, labelWidth: 132 }
      )
      pdf.moveDown(0.4)
      paragraph('BÊN THUÊ (sau đây gọi là Bên B)', {
        font: FONT_BOLD,
        align: 'left',
      })
      drawLabelRows(
        pdf,
        theme,
        partyRows({
          name: contract.tenantName,
          cccd: contract.tenantCccd,
          issued: contract.tenantIdIssued ?? null,
          birthDate: contract.tenantBirthDate ?? null,
          address: contract.tenantAddress,
          phone: contract.tenantPhone ?? null,
        }),
        { x: MARGIN_LEFT + 14, width: contentWidth - 14, labelWidth: 132 }
      )
      pdf.moveDown(0.5)

      paragraph('THÔNG TIN CĂN HỘ CHO THUÊ', {
        font: FONT_BOLD,
        align: 'left',
      })
      drawLabelRows(
        pdf,
        theme,
        [
          { label: 'Căn hộ:', value: contract.propertyTitle || PENDING_VALUE },
          {
            label: 'Địa chỉ:',
            value: contract.propertyAddress || PENDING_VALUE,
          },
          {
            label: 'Diện tích:',
            value: contract.propertyArea
              ? `${contract.propertyArea} m²`
              : PENDING_VALUE,
          },
          {
            label: 'Giấy chứng nhận sở hữu:',
            value: contract.propertyOwnershipCertificate || PENDING_VALUE,
          },
        ],
        { x: MARGIN_LEFT + 14, width: contentWidth - 14, labelWidth: 132 }
      )
      pdf.moveDown(0.5)

      drawSummaryBox(pdf, theme, 'TÓM TẮT ĐIỀU KHOẢN THƯƠNG MẠI', [
        {
          label: 'Thời hạn thuê:',
          value: `${commercial.durationMonths} tháng, từ ${formatDate(contract.startDate)} đến ${formatDate(contract.endDate)}`,
        },
        {
          label: 'Giá thuê hằng tháng:',
          value: moneyWithWords(commercial.monthlyRent),
          emphasis: true,
        },
        {
          label: 'Tiền đặt cọc:',
          value: moneyWithWords(commercial.deposit),
          emphasis: true,
        },
        {
          label: 'Hạn thanh toán:',
          value: `Chậm nhất ngày ${commercial.paymentDay} hằng tháng`,
        },
        {
          label: 'Lãi chậm trả:',
          value: `${commercial.latePenaltyRate}%/năm (không vượt mức tối đa theo pháp luật)`,
        },
        {
          label: 'Báo trước khi chấm dứt:',
          value: `${commercial.terminationNoticeDays} ngày`,
        },
      ])

      paragraph(
        'Hai Bên cùng thỏa thuận và thống nhất ký kết Hợp đồng thuê căn hộ với các điều khoản sau đây:',
        { after: 0.7 }
      )

      for (const section of document.sections) {
        if (pdf.y > pdf.page.height - MARGIN_BOTTOM - 80) pdf.addPage()
        paragraph(`Điều ${section.number}. ${section.title}`, {
          font: FONT_BOLD,
          align: 'left',
        })
        pdf.moveDown(0.15)
        clauseBody(section.content)
        pdf.moveDown(0.7)
      }

      const schedule = buildRentSchedule({
        startDate: contract.startDate,
        durationMonths: commercial.durationMonths,
        paymentDay: commercial.paymentDay,
        monthlyRent: commercial.monthlyRent,
      })
      if (schedule.length > 0) {
        if (pdf.y > pdf.page.height - MARGIN_BOTTOM - 120) pdf.addPage()
        paragraph('Bảng lịch thanh toán tiền thuê (kèm theo Điều 4)', {
          font: FONT_BOLD,
          align: 'left',
          after: 0.3,
        })
        drawTable(
          pdf,
          theme,
          [
            { header: 'Kỳ', width: 28, align: 'center' },
            { header: 'Thời gian thuê', width: 150, align: 'center' },
            { header: 'Hạn thanh toán', width: 90, align: 'center' },
            { header: 'Số tiền (VNĐ)', width: 100, align: 'right' },
          ],
          schedule.map(row => [
            String(row.period),
            `${formatDate(row.from)} - ${formatDate(row.to)}`,
            formatDate(row.dueDate),
            new Intl.NumberFormat('vi-VN').format(row.amount),
          ]),
          {
            footer: [
              '',
              `Tổng ${schedule.length} kỳ`,
              '',
              new Intl.NumberFormat('vi-VN').format(
                schedule.reduce((sum, row) => sum + row.amount, 0)
              ),
            ],
          }
        )
        paragraph(
          `Tiền đặt cọc ${formatMoney(commercial.deposit)} được thanh toán riêng theo Điều 5, không nằm trong bảng trên.`,
          { font: FONT_ITALIC, size: BODY_SIZE - 1, after: 0.8 }
        )
      }

      if ((document.supplementaryClauses?.length ?? 0) > 0) {
        paragraph('Điều khoản bổ sung', { font: FONT_BOLD, align: 'left' })
        pdf.moveDown(0.15)
        for (const clause of document.supplementaryClauses ?? []) {
          paragraph(clause.title, { font: FONT_BOLD, align: 'left' })
          clauseBody(clause.content)
          pdf.moveDown(0.5)
        }
      }

      if (document.annexes.length > 0) {
        paragraph('Phụ lục kèm theo hợp đồng', {
          font: FONT_BOLD,
          align: 'left',
        })
        pdf.moveDown(0.15)
        for (const annex of document.annexes) {
          paragraph(`- ${annex.title}${annex.required ? ' (bắt buộc)' : ''}`, {
            align: 'left',
            indent: 14,
          })
        }
        pdf.moveDown(1)
      }

      // Khối chữ ký: giữ nguyên trên cùng một trang.
      if (pdf.y > pdf.page.height - MARGIN_BOTTOM - 230) pdf.addPage()
      paragraph(
        `Hợp đồng được lập tại ${place}, ngày ${signedDate}, dưới dạng thông điệp dữ liệu, được ký bằng chữ ký số; mỗi Bên giữ một (01) bản có giá trị pháp lý như nhau. Các Bên đã đọc, hiểu rõ và có đầy đủ thẩm quyền giao kết hợp đồng này.`,
        { after: 0.8 }
      )
      const blockTop = pdf.y
      const colWidth = contentWidth / 2
      drawSignatureBox(pdf, theme, {
        x: MARGIN_LEFT,
        top: blockTop,
        width: colWidth,
        title: 'ĐẠI DIỆN BÊN CHO THUÊ (BÊN A)',
        name: contract.landlordName,
      })
      drawSignatureBox(pdf, theme, {
        x: MARGIN_LEFT + colWidth,
        top: blockTop,
        width: colWidth,
        title: 'ĐẠI DIỆN BÊN THUÊ (BÊN B)',
        name: contract.tenantName,
      })

      // Chân trang: mã băm nội dung đã khóa + số trang.
      const range = pdf.bufferedPageRange()
      for (let index = 0; index < range.count; index += 1) {
        pdf.switchToPage(range.start + index)
        pdf.page.margins.bottom = 0
        pdf
          .font(FONT_REGULAR)
          .fontSize(8.5)
          .fillColor('#555555')
          .text(
            `TH-PropTech · ${contract.contractCode} · Hash nội dung: ${(document.lockedHash ?? '').slice(0, 24)}… · Trang ${index + 1}/${range.count}`,
            MARGIN_LEFT,
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
