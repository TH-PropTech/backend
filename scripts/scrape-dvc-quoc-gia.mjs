/**
 * Thu thập thủ tục hành chính từ Cổng Dịch vụ công Quốc gia (dichvucong.gov.vn).
 *
 * Cổng này chặn truy cập tự động (WAF), nên script mở Microsoft Edge thật có giao diện
 * (headless sẽ bị từ chối) và dùng chính ô tìm kiếm của cổng. Cửa sổ Edge sẽ hiện trong
 * vài phút; không cần thao tác gì.
 *
 * Chạy: node backend/scripts/scrape-dvc-quoc-gia.mjs
 * Cần Playwright (có sẵn ở frontend/node_modules) và Microsoft Edge.
 * Kết quả: backend/src/modules/legal-knowledge/data/dvc-quoc-gia.json, được
 * `pnpm seed:legal` nạp vào kho tri thức.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(here, '../../frontend/package.json'))
const { chromium } = require('playwright')

const PORTAL = 'https://dichvucong.gov.vn'
const OUTPUT = resolve(
  here,
  '../src/modules/legal-knowledge/data/dvc-quoc-gia.json'
)

/** Từ khoá tìm trên cổng; `match` lọc tên thủ tục để chỉ lấy đúng chủ đề thuê nhà. */
const QUERIES = [
  { keyword: 'đăng ký tạm trú', match: /tạm trú/i },
  { keyword: 'đăng ký thường trú', match: /thường trú/i },
  { keyword: 'xác nhận thông tin về cư trú', match: /xác nhận.*cư trú/i },
  { keyword: 'thuê nhà ở', match: /thuê.*nhà ở|nhà ở.*thuê/i },
]
const PER_QUERY_LIMIT = 3
const SETTLE_MS = 7000

const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
})
const context = await browser.newContext({
  locale: 'vi-VN',
  viewport: { width: 1366, height: 900 },
})
const page = await context.newPage()

async function bodyText() {
  return page.evaluate(() => document.body.innerText)
}

// Vào trang chủ trước để nhận cookie của WAF.
await page.goto(`${PORTAL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)

const seen = new Map()
for (const query of QUERIES) {
  const searchUrl = `${PORTAL}/tra-cuu-thu-tuc/danh-sach?keyword=${encodeURIComponent(query.keyword)}&showAdvanced=false&formalityType=STANDARD&limit=10&activeKey=STANDARD`
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(SETTLE_MS)

  // Mỗi dòng kết quả: mã, tên, cơ quan ban hành, cơ quan thực hiện, lĩnh vực.
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/thu-tuc-hanh-chinh/"]')].map(a => {
      const row = a.closest('tr') ?? a.parentElement
      const cells = row
        ? [...row.querySelectorAll('td')].map(td => td.innerText.trim())
        : []
      return { href: a.href, text: a.innerText.trim(), cells }
    })
  )
  const picked = []
  for (const row of rows) {
    if (!/\/thu-tuc-hanh-chinh\/[0-9a-f-]{20,}/.test(row.href)) continue
    const title = row.cells[1] ?? row.text
    if (!title || /^\d+\.\d+/.test(title) || !query.match.test(title)) continue
    if (seen.has(row.href) || picked.some(p => p.href === row.href)) continue
    picked.push({
      href: row.href,
      code: row.cells[0] ?? '',
      title,
      issuer: row.cells[2] ?? '',
      executor: row.cells[3] ?? '',
      field: row.cells[4] ?? '',
    })
  }
  console.log(`[${query.keyword}] ${picked.length} thủ tục phù hợp`)

  for (const item of picked.slice(0, PER_QUERY_LIMIT)) {
    await page.goto(item.href, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await page.waitForTimeout(SETTLE_MS)
    const text = (await bodyText()).trim()
    if (text.length < 400 || /Trang không tồn tại|rejected/i.test(text)) {
      console.log(`  x bỏ qua (nội dung rỗng): ${item.title}`)
      continue
    }
    seen.set(item.href, { ...item, query: query.keyword, text })
    console.log(`  + ${item.code} ${item.title} (${text.length} ký tự)`)
  }
}

await browser.close()

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      scrapedAt: new Date().toISOString(),
      source: PORTAL,
      procedures: [...seen.values()],
    },
    null,
    1
  ),
  'utf8'
)
console.log(`\nĐã lưu ${seen.size} thủ tục vào ${OUTPUT}`)
