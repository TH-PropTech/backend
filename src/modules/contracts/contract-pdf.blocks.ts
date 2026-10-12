import type PDFDocument from 'pdfkit'

/** Khối vẽ dùng chung cho PDF hợp đồng: bảng nhãn–giá trị, hộp tóm tắt, bảng lịch thanh toán, ô chữ ký. */

export type PdfDoc = InstanceType<typeof PDFDocument>

export type BlockTheme = {
  left: number
  width: number
  bottom: number
  regular: string
  bold: string
  italic: string
  bodySize: number
  accent: string
  soft: string
  line: string
}

export type LabelRow = { label: string; value: string; emphasis?: boolean }

/** Một dòng nhãn–giá trị; tự xuống dòng và tự sang trang nếu hết chỗ. */
export function drawLabelRows(
  pdf: PdfDoc,
  theme: BlockTheme,
  rows: LabelRow[],
  options: {
    x?: number
    width?: number
    labelWidth?: number
    size?: number
  } = {}
): void {
  const x = options.x ?? theme.left
  const width = options.width ?? theme.width
  const labelWidth = options.labelWidth ?? 120
  const size = options.size ?? theme.bodySize
  const valueWidth = width - labelWidth
  for (const row of rows) {
    pdf.font(row.emphasis ? theme.bold : theme.regular).fontSize(size)
    const height = Math.max(
      pdf.heightOfString(row.value, { width: valueWidth, lineGap: 2 }),
      size
    )
    if (pdf.y + height > pdf.page.height - theme.bottom) pdf.addPage()
    const y = pdf.y
    pdf
      .font(theme.bold)
      .fontSize(size)
      .fillColor('#222222')
      .text(row.label, x, y, { width: labelWidth - 6, lineGap: 2 })
    pdf
      .font(row.emphasis ? theme.bold : theme.regular)
      .fontSize(size)
      .fillColor('#000000')
      .text(row.value, x + labelWidth, y, { width: valueWidth, lineGap: 2 })
    pdf.y = y + height + 3
  }
}

/** Hộp nền nhạt có viền tiêu đề, chứa các cặp nhãn–giá trị (tóm tắt điều khoản thương mại). */
export function drawSummaryBox(
  pdf: PdfDoc,
  theme: BlockTheme,
  title: string,
  rows: LabelRow[]
): void {
  const padding = 10
  const labelWidth = 150
  const innerWidth = theme.width - padding * 2
  pdf.font(theme.regular).fontSize(theme.bodySize)
  let height = padding * 2 + 20
  for (const row of rows) {
    height +=
      Math.max(
        pdf.heightOfString(row.value, {
          width: innerWidth - labelWidth,
          lineGap: 2,
        }),
        theme.bodySize
      ) + 3
  }
  if (pdf.y + height > pdf.page.height - theme.bottom) pdf.addPage()
  const top = pdf.y
  pdf
    .roundedRect(theme.left, top, theme.width, height, 4)
    .fillAndStroke(theme.soft, theme.line)
  pdf
    .font(theme.bold)
    .fontSize(theme.bodySize)
    .fillColor(theme.accent)
    .text(title, theme.left + padding, top + padding, {
      width: innerWidth,
    })
  pdf.fillColor('#000000')
  pdf.y = top + padding + 20
  drawLabelRows(pdf, theme, rows, {
    x: theme.left + padding,
    width: innerWidth,
    labelWidth,
  })
  pdf.y = top + height + 8
}

export type TableColumn = {
  header: string
  width: number
  align?: 'left' | 'center' | 'right'
}

/** Bảng kẻ ô, hàng tiêu đề tô màu, tự ngắt trang và lặp tiêu đề. */
export function drawTable(
  pdf: PdfDoc,
  theme: BlockTheme,
  columns: TableColumn[],
  rows: string[][],
  options: { size?: number; footer?: string[] } = {}
): void {
  const size = options.size ?? theme.bodySize - 1
  const padding = 4
  const rowHeight = size + padding * 2 + 2
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0)
  const scale = theme.width / totalWidth

  const drawRow = (
    cells: string[],
    y: number,
    style: { header?: boolean; shade?: boolean; bold?: boolean }
  ): void => {
    let x = theme.left
    columns.forEach((column, index) => {
      const w = column.width * scale
      if (style.header) {
        pdf.rect(x, y, w, rowHeight).fillAndStroke(theme.accent, theme.accent)
      } else {
        pdf
          .rect(x, y, w, rowHeight)
          .fillAndStroke(style.shade ? theme.soft : '#FFFFFF', theme.line)
      }
      pdf
        .font(style.header || style.bold ? theme.bold : theme.regular)
        .fontSize(size)
        .fillColor(style.header ? '#FFFFFF' : '#000000')
        .text(cells[index] ?? '', x + padding, y + padding + 1, {
          width: w - padding * 2,
          align: style.header ? 'center' : (column.align ?? 'left'),
          lineBreak: false,
          ellipsis: true,
        })
      x += w
    })
    pdf.fillColor('#000000')
  }

  const header = columns.map(column => column.header)
  let y = pdf.y
  if (y + rowHeight * 3 > pdf.page.height - theme.bottom) {
    pdf.addPage()
    y = pdf.y
  }
  drawRow(header, y, { header: true })
  y += rowHeight
  rows.forEach((cells, index) => {
    if (y + rowHeight > pdf.page.height - theme.bottom) {
      pdf.addPage()
      y = pdf.y
      drawRow(header, y, { header: true })
      y += rowHeight
    }
    drawRow(cells, y, { shade: index % 2 === 1 })
    y += rowHeight
  })
  if (options.footer) {
    if (y + rowHeight > pdf.page.height - theme.bottom) {
      pdf.addPage()
      y = pdf.y
    }
    drawRow(options.footer, y, { bold: true, shade: true })
    y += rowHeight
  }
  pdf.y = y + 8
  pdf.x = theme.left
}

/** Ô chữ ký nét đứt: hợp đồng đã khóa nên chỗ này chỉ báo trước nơi chữ ký số sẽ hiển thị. */
export function drawSignatureBox(
  pdf: PdfDoc,
  theme: BlockTheme,
  input: {
    x: number
    top: number
    width: number
    title: string
    name: string | null
  }
): void {
  const boxWidth = Math.min(180, input.width - 20)
  const boxX = input.x + (input.width - boxWidth) / 2
  pdf
    .font(theme.bold)
    .fontSize(theme.bodySize)
    .fillColor('#000000')
    .text(input.title, input.x, input.top, {
      width: input.width,
      align: 'center',
    })
  pdf
    .font(theme.italic)
    .fontSize(theme.bodySize - 1)
    .fillColor('#444444')
    .text('(Ký, ghi rõ họ tên)', input.x, input.top + 16, {
      width: input.width,
      align: 'center',
    })
  pdf
    .roundedRect(boxX, input.top + 38, boxWidth, 66, 5)
    .lineWidth(0.8)
    .dash(3, { space: 2 })
    .stroke('#999999')
    .undash()
  pdf
    .font(theme.italic)
    .fontSize(theme.bodySize - 2)
    .fillColor('#888888')
    .text('Chữ ký số VNPT SmartCA', boxX, input.top + 64, {
      width: boxWidth,
      align: 'center',
    })
  pdf
    .font(theme.bold)
    .fontSize(theme.bodySize)
    .fillColor('#000000')
    .text(input.name ?? '', input.x, input.top + 112, {
      width: input.width,
      align: 'center',
    })
}
