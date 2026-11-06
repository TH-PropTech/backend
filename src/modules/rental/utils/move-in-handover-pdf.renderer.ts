import * as path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { MoveInSettlement } from '../schemas/move-in-settlement.schema'
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

export const MOVE_IN_HANDOVER_PDF_RENDERER_VERSION =
  'th-proptech-handover-pdf-v1'

const MARGIN_TOP = 57
const MARGIN_BOTTOM = 57
const MARGIN_LEFT = 57
const MARGIN_RIGHT = 57
const BODY_SIZE = 11
const FONT_REGULAR = 'Body'
const FONT_BOLD = 'Body-Bold'
const FONT_ITALIC = 'Body-Italic'

function resolveFontDir(): string {
  return path.join(__dirname, '..', '..', 'contracts', 'fonts')
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

const CONDITION_LABEL: Record<'good' | 'damaged', string> = {
  good: 'Tốt',
  damaged: 'Hư hỏng',
}

/**
 * PDF một trang cho biên bản bàn giao đã hoàn tất (`handover.completedAt`
 * khác null). Không phải hợp đồng ký số — chỉ ghi lại xác nhận trong ứng
 * dụng của hai bên (không có ô chữ ký SmartCA).
 */
export function renderMoveInHandoverPdf(
  contract: Pick<
    Contract,
    'contractCode' | 'propertyAddress' | 'landlordName' | 'tenantName'
  > &
    Partial<Pick<Contract, 'utilityRates' | 'effectiveCommercial'>>,
  settlement: MoveInSettlement
): Promise<Buffer> {
  const handover = settlement.handover
  if (!handover) {
    return Promise.reject(new Error('HANDOVER_NOT_RECORDED'))
  }
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
        Title: `Biên bản bàn giao - ${contract.contractCode}`,
        Author: 'TH-PropTech',
        Producer: MOVE_IN_HANDOVER_PDF_RENDERER_VERSION,
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
      const contentWidth = pdf.page.width - MARGIN_LEFT - MARGIN_RIGHT
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

      pdf
        .font(FONT_BOLD)
        .fontSize(16)
        .text('BIÊN BẢN BÀN GIAO CĂN HỘ', MARGIN_LEFT, pdf.y, {
          width: contentWidth,
          align: 'center',
        })
      pdf.moveDown(0.3)
      pdf
        .font(FONT_ITALIC)
        .fontSize(BODY_SIZE - 1)
        .fillColor('#555555')
        .text(
          `Hợp đồng ${contract.contractCode}${handover.recordedBy ? ` · Bản ghi lần ${handover.revision}` : ''}`,
          MARGIN_LEFT,
          pdf.y,
          { width: contentWidth, align: 'center' }
        )
      pdf.fillColor('#000000')
      pdf.moveDown(1)

      drawLabelRows(
        pdf,
        theme,
        [
          { label: 'Căn hộ', value: contract.propertyAddress ?? '—' },
          { label: 'Bên cho thuê', value: contract.landlordName ?? '—' },
          { label: 'Bên thuê', value: contract.tenantName ?? '—' },
          {
            label: 'Thời điểm bàn giao',
            value: formatDateTime(new Date(handover.handedOverAt)),
          },
        ],
        { x: MARGIN_LEFT, width: contentWidth, labelWidth: 150 }
      )
      pdf.moveDown(1)

      drawSummaryBox(pdf, theme, 'Chỉ số & chìa khóa', [
        {
          label: 'Chỉ số điện',
          value: String(handover.meterReadings.electricity),
        },
        {
          label: 'Chỉ số nước',
          value: String(handover.meterReadings.water),
        },
        { label: 'Số chìa khóa', value: String(handover.keyCount) },
      ])
      pdf.moveDown(0.5)

      const items = handover.inventoryItems ?? []
      pdf
        .font(FONT_BOLD)
        .fontSize(BODY_SIZE)
        .text('Danh mục thiết bị, nội thất', MARGIN_LEFT, pdf.y, {
          width: contentWidth,
        })
      pdf.moveDown(0.3)
      if (items.length) {
        drawTable(
          pdf,
          theme,
          [
            { header: 'Tên', width: 220 },
            { header: 'SL', width: 60, align: 'center' },
            { header: 'Tình trạng', width: 100, align: 'center' },
            { header: 'Ghi chú', width: 160 },
          ],
          items.map(item => [
            item.name,
            String(item.quantity),
            CONDITION_LABEL[item.condition],
            item.note ?? '',
          ])
        )
      } else {
        pdf
          .font(FONT_ITALIC)
          .fontSize(BODY_SIZE - 1)
          .fillColor('#777777')
          .text('Không có dòng nào.', MARGIN_LEFT, pdf.y, {
            width: contentWidth,
          })
        pdf.fillColor('#000000')
        pdf.moveDown(1)
      }

      const checklist = handover.checklist ?? []
      if (checklist.length) {
        pdf
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE)
          .text('Các mục kiểm tra khi bàn giao', MARGIN_LEFT, pdf.y, {
            width: contentWidth,
          })
        pdf.moveDown(0.3)
        drawTable(
          pdf,
          theme,
          [
            { header: 'Mục kiểm tra', width: 420 },
            { header: 'Kết quả', width: 120, align: 'center' },
          ],
          checklist.map(entry => [
            entry.label,
            entry.checked ? 'Đã thực hiện' : 'Chưa thực hiện',
          ])
        )
        pdf.moveDown(0.5)
      }

      if (handover.notes) {
        pdf
          .font(FONT_BOLD)
          .fontSize(BODY_SIZE)
          .text('Ghi chú', MARGIN_LEFT, pdf.y, { width: contentWidth })
        pdf.moveDown(0.2)
        pdf
          .font(FONT_REGULAR)
          .fontSize(BODY_SIZE)
          .text(handover.notes, MARGIN_LEFT, pdf.y, {
            width: contentWidth,
            lineGap: 2,
          })
        pdf.moveDown(1)
      }

      pdf
        .font(FONT_BOLD)
        .fontSize(BODY_SIZE)
        .text('Điện, nước và dịch vụ', MARGIN_LEFT, pdf.y, {
          width: contentWidth,
        })
      pdf.moveDown(0.2)
      pdf
        .font(FONT_REGULAR)
        .fontSize(BODY_SIZE)
        .text(
          [
            UTILITY_SETTLEMENT_NOTE,
            describeUtilityRates(resolveContractUtilityRates(contract)),
          ]
            .filter(Boolean)
            .join(' '),
          MARGIN_LEFT,
          pdf.y,
          { width: contentWidth, lineGap: 2 }
        )
      pdf.moveDown(1)

      const confirmRows = [
        {
          label: 'Khách thuê xác nhận',
          value: handover.tenantConfirmation
            ? formatDateTime(new Date(handover.tenantConfirmation.at))
            : 'Không phản hồi trong hạn (tự hoàn tất theo Điều 9.1)',
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
      ]
      drawSummaryBox(pdf, theme, 'Xác nhận hai bên', confirmRows)

      pdf.moveDown(0.5)
      pdf
        .font(FONT_ITALIC)
        .fontSize(BODY_SIZE - 2)
        .fillColor('#777777')
        .text(
          'Biên bản ghi nhận xác nhận điện tử trong ứng dụng TH-PropTech của hai bên, không phải chữ ký số SmartCA. Mã băm biên bản được lưu trên hệ thống để đối chiếu khi cần.',
          MARGIN_LEFT,
          pdf.y,
          { width: contentWidth, lineGap: 2 }
        )
      pdf.fillColor('#000000')

      pdf.end()
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
