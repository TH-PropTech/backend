import { extractMainText } from './html-extract'

describe('extractMainText', () => {
  it('keeps content inside a form that wraps the whole page (ASP.NET)', () => {
    const html = `<body><form id="aspnetForm">
      <div class="page-header">Cổng thông tin</div>
      <div class="servicedetail"><p>Thành phần hồ sơ: tờ khai thay đổi thông tin cư trú.</p></div>
    </form></body>`
    expect(extractMainText(html).text).toContain('Thành phần hồ sơ')
  })

  it('still drops a small search form', () => {
    const html = `<body><form><input value="x">Tìm kiếm nhanh</form>
      <main><p>Nội dung chính của trang rất dài để vượt trội so với ô tìm kiếm nhỏ.</p></main></body>`
    expect(extractMainText(html).text).not.toContain('Tìm kiếm nhanh')
  })

  it('removes navigation, footer, scripts and ad blocks', () => {
    const html = `
      <html><head><title>Thủ tục thuê nhà</title><script>var x = 1</script></head>
      <body>
        <nav><a href="/">Trang chủ</a> <a href="/menu">Menu cũ</a></nav>
        <div class="sidebar-ads">Quảng cáo hấp dẫn</div>
        <div id="cookie-banner">Chúng tôi dùng cookie</div>
        <main>
          <p>Điều 1. Thời hạn thuê nhà không quá 5 năm.</p>
        </main>
        <footer>Bản quyền 2026</footer>
        <style>.a{color:red}</style>
      </body></html>`

    const result = extractMainText(html)
    expect(result.title).toBe('Thủ tục thuê nhà')
    expect(result.text).toContain('Điều 1. Thời hạn thuê nhà không quá 5 năm.')
    expect(result.text).not.toContain('Trang chủ')
    expect(result.text).not.toContain('Quảng cáo')
    expect(result.text).not.toContain('cookie')
    expect(result.text).not.toContain('Bản quyền')
    expect(result.text).not.toContain('var x')
    expect(result.text).not.toContain('color:red')
  })

  it('prefers the article element over the body', () => {
    const html = `<body><div>Thông tin chung của trang web</div>
      <article><h1>Luật Nhà ở</h1><p>Nội dung chính của luật nhà ở.</p></article></body>`
    const result = extractMainText(html)
    expect(result.text).toContain('Nội dung chính của luật nhà ở.')
    expect(result.text).not.toContain('Thông tin chung')
  })

  it('does not drop the main content when a wrapper has a noisy class name', () => {
    const html = `<body><div class="layout-with-sidebar">
      <div class="entry-content"><p>Nội dung quy định đầy đủ về đặt cọc.</p></div>
      </div></body>`
    const result = extractMainText(html)
    expect(result.text).toContain('Nội dung quy định đầy đủ về đặt cọc.')
  })

  it('decodes HTML entities', () => {
    const html = `<body><p>Tiền &amp; tài sản &lt;đặt cọc&gt; &nbsp;&quot;hợp đồng&quot;</p></body>`
    const result = extractMainText(html)
    expect(result.text).toContain('Tiền & tài sản <đặt cọc> "hợp đồng"')
  })

  it('keeps headings on their own lines and prefixes list items', () => {
    const html = `<body><main>
      <h2>Hồ sơ cần chuẩn bị</h2>
      <p>Gồm các giấy tờ sau:</p>
      <ul><li>Căn cước công dân</li><li>Hợp đồng lao động</li></ul>
      <p>Hết.</p>
    </main></body>`
    const result = extractMainText(html)
    const lines = result.text.split('\n')
    expect(lines).toContain('Hồ sơ cần chuẩn bị')
    expect(lines).toContain('- Căn cước công dân')
    expect(lines).toContain('- Hợp đồng lao động')
    expect(lines.indexOf('Hồ sơ cần chuẩn bị')).toBeLessThan(
      lines.indexOf('- Căn cước công dân')
    )
  })

  it('turns table rows into lines', () => {
    const html = `<body><main><table>
      <tr><td>Loại</td><td>Lệ phí</td></tr>
      <tr><td>Nhà ở</td><td>100.000</td></tr>
    </table></main></body>`
    const lines = extractMainText(html).text.split('\n')
    expect(lines.some(l => l.includes('Nhà ở') && l.includes('100.000'))).toBe(
      true
    )
  })

  it('collapses excessive blank lines and whitespace', () => {
    const html = `<body><main><p>A</p>\n\n\n\n\n<p>   B    C   </p></main></body>`
    const text = extractMainText(html).text
    expect(text).not.toMatch(/\n{3,}/)
    expect(text).toContain('B C')
    expect(text).toBe(text.trim())
  })

  it('omits title when the page has none', () => {
    const result = extractMainText('<body><main><p>Nội dung</p></main></body>')
    expect(result).not.toHaveProperty('title')
    expect(result.text).toBe('Nội dung')
  })

  it('falls back to the h1 for the title', () => {
    const result = extractMainText(
      '<body><h1>Tiêu đề từ H1</h1><p>x</p></body>'
    )
    expect(result.title).toBe('Tiêu đề từ H1')
  })

  it('never throws on malformed HTML', () => {
    expect(() => extractMainText('<div><p>unclosed <b>tags')).not.toThrow()
    expect(() => extractMainText('')).not.toThrow()
    expect(extractMainText('').text).toBe('')
  })
})
