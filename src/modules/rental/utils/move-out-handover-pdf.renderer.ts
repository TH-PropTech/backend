import * as path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveOutHandover } from '../schemas/move-out-handover.schema'
import {
  UTILITY_SETTLEMENT_NOTE,
  describeUtilityRates,
  resolveContractUtilityRates,
} from './utility-note.util'
import {
  drawLabelRows,
  drawSummaryBox,
  drawTable,
  type BlockTheme,
} from '../../contracts/utils/contract-pdf.blocks'

export const MOVE_OUT_HANDOVER_PDF_RENDERER_VERSION =
  'th-proptech-move-out-pdf-v1'

const MARGIN = 57
const BODY_SIZE = 11
const FONT_REGULAR = 'Body'
const FONT_BOLD = 'Body-Bold'
const FONT_ITALIC = 'Body-Italic'
const MISSING = 'Chưa cập nhật'

const CONDITION_LABEL: Record<string, string> = {
  good: 'Tốt',
  damaged: 'Hư hỏng',
  missing: 'Thiếu',
}

const formatDateTime = (value: Date): string =>
  new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)

/** PDF biên bản trả nhà đã hoàn tất. Xác nhận điện tử trong ứng dụng, không phải chữ ký số. */
export function renderMoveOutHandoverPdf(
  contract: Pick<
    Contract,
    'contractCode' | 'propertyAddress' | 'landlordName' | 'tenantName'
  > &
    Partial<Pick<Contract, 'utilityRates' | 'effectiveCommercial'>>,
  handover: MoveOutHandover
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const fontDir = path.join(__dirname, '..', '..', 'contracts', 'fonts')
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `Biên bản trả nhà - ${contract.contractCode}`,
        Author: 'TH-PropTech',
        Producer: MOVE_OUT_HANDOVER_PDF_RENDERER_VERSION,
        CreationDate: handover.completedAt
          ? new Date(handover.completedAt)
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
      const width = pdf.page.width - MARGIN * 2
      const theme: BlockTheme = {
        left: MARGIN,
        width,
        bottom: MARGIN,
        regular: FONT_REGULAR,
        bold: FONT_BOLD,
        italic: FONT_ITALIC,
        bodySize: BODY_SIZE,
        accent: '#7A2E1D',
        soft: '#F7F1EC',
        line: '#D9C7BC',
      }
      pdf
        .font(FONT_BOLD)
        .fontSize(16)
        .text('BIÊN BẢN TRẢ NHÀ', MARGIN, pdf.y, { width, align: 'center' })
      pdf.moveDown(0.3)
      pdf
        .font(FONT_ITALIC)
        .fontSize(BODY_SIZE - 1)
        .fillColor('#555555')
        .text(
          `Hợp đồng ${contract.contractCode} · Bản ghi lần ${handover.revision}`,
          MARGIN,
          pdf.y,
          { width, align: 'center' }
        )
      pdf.fillColor('#000000')
      pdf.moveDown(1)

      drawLabelRows(
        pdf,
        theme,
        [
          { label: 'Căn hộ', value: contract.propertyAddress ?? MISSING },
          { label: 'Bên cho thuê', value: contract.landlordName ?? MISSING },
          { label: 'Bên thuê', value: contract.tenantName ?? MISSING },
          {
            label: 'Thời điểm trả nhà',
            value: formatDateTime(new Date(handover.handedBackAt)),
          },
        ],
        { x: MARGIN, width, labelWidth: 150 }
      )
      pdf.moveDown(1)

      drawSummaryBox(pdf, theme, 'Chỉ số & chìa khóa', [
        {
          label: 'Chỉ số điện',
          value: String(handover.meterReadings.electricity),
        },
        { label: 'Chỉ số nước', value: String(handover.meterReadings.water) },
        { label: 'Số chìa khóa', value: String(handover.keyCount) },
      ])
      pdf.moveDown(0.5)

      pdf
        .font(FONT_BOLD)
        .fontSize(BODY_SIZE)
        .text('Đối chiếu đồ đạc lúc nhận và lúc trả', MARGIN, pdf.y, { width })
      pdf.moveDown(0.3)
      if (handover.inventoryItems.length) {
        drawTable(
          pdf,
          theme,
          [
            { header: 'Tên', width: 150 },
            { header: 'SL', width: 40, align: 'center' },
            { header: 'Lúc nhận', width: 75, align: 'center' },
            { header: 'Lúc trả', width: 75, align: 'center' },
            { header: 'Ghi chú', width: 140 },
          ],
          handover.inventoryItems.map(item => [
            item.name,
            String(item.quantity),
            item.conditionAtMoveIn
              ? (CONDITION_LABEL[item.conditionAtMoveIn] ?? '')
              : '—',
            CONDITION_LABEL[item.condition] ?? '',
            item.note ?? '',
          ])
        )
      } else {
        pdf
          .font(FONT_ITALIC)
          .fontSize(BODY_SIZE - 1)
          .fillColor('#777777')
          .text('Không có dòng nào.', MARGIN, pdf.y, { width })
        pdf.fillColor('#000000')
        pdf.moveDown(1)
      }

      if (handover.notes) {
        pdf
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE)
          .text('Ghi chú', MARGIN, pdf.y, { width })
        pdf.moveDown(0.2)
        pdf
          .font(FONT_REGULAR)
          .text(handover.notes, MARGIN, pdf.y, { width, lineGap: 2 })
        pdf.moveDown(1)
      }

      pdf
        .font(FONT_BOLD)
        .fontSize(BODY_SIZE)
        .text('Điện, nước và dịch vụ', MARGIN, pdf.y, { width })
      pdf.moveDown(0.2)
      pdf
        .font(FONT_REGULAR)
        .text(
          [
            UTILITY_SETTLEMENT_NOTE,
            describeUtilityRates(resolveContractUtilityRates(contract)),
          ]
            .filter(Boolean)
            .join(' '),
          MARGIN,
          pdf.y,
          { width, lineGap: 2 }
        )
      pdf.moveDown(1)

      drawSummaryBox(pdf, theme, 'Xác nhận hai bên', [
        {
          label: 'Khách thuê xác nhận',
          value: handover.tenantConfirmation
            ? formatDateTime(new Date(handover.tenantConfirmation.at))
            : 'Không phản hồi trong hạn (tự hoàn tất)',
        },
        {
          label: 'Chủ nhà xác nhận',
          value: handover.landlordConfirmation
            ? formatDateTime(new Date(handover.landlordConfirmation.at))
            : '—',
        },
        {
          label: 'Hoàn tất lúc',
          value: handover.completedAt
            ? formatDateTime(new Date(handover.completedAt))
            : '—',
        },
      ])
      pdf.moveDown(0.5)
      pdf
        .font(FONT_ITALIC)
        .fontSize(BODY_SIZE - 2)
        .fillColor('#777777')
        .text(
          'Biên bản ghi nhận xác nhận điện tử trong ứng dụng TH-PropTech của hai bên, không phải chữ ký số. Mã xác thực nội dung biên bản được lưu để đối chiếu khi cần.',
          MARGIN,
          pdf.y,
          { width, lineGap: 2 }
        )
      pdf.fillColor('#000000')
      pdf.end()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
