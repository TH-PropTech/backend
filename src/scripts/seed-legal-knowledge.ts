/* eslint-disable no-console */
import * as dns from 'dns'
import * as fs from 'fs'
import * as path from 'path'

// Cùng cơ chế với main.ts: dotenv/config đã nạp .env, driver MongoDB phân giải SRV qua dns.promises
const dnsServers = (process.env['NODE_DNS_SERVERS'] ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
if (dnsServers.length > 0) {
  dns.setServers(dnsServers)
  dns.promises.setServers(dnsServers)
}

import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { LegalKnowledgeService } from '../modules/legal-knowledge/legal-knowledge.service'
import { LEGAL_SEED_ENTRIES } from '../modules/legal-knowledge/legal-knowledge.seed-data'
import { extractMainText } from '../modules/legal-knowledge/html-extract'
import {
  cleanPortalProcedure,
  cleanSourceText,
} from '../modules/legal-knowledge/legal-seed-clean'
import type { LegalSeedEntry } from '../modules/legal-knowledge/legal-knowledge.seed-data'
import { fetchPageHtml } from '../modules/legal-knowledge/safe-fetch'
import {
  LEGAL_CONTENT_MAX,
  LEGAL_CONTENT_MIN,
} from '../modules/legal-knowledge/dto/legal-knowledge.dto'

interface PortalProcedure {
  href: string
  code: string
  title: string
  issuer: string
  executor: string
  field: string
  query: string
  text: string
}

const PORTAL_FILE = path.join(
  __dirname,
  '..',
  'modules',
  'legal-knowledge',
  'data',
  'dvc-quoc-gia.json'
)
const PORTAL_TITLE_MAX = 230
const PORTAL_KEYWORD_MAX = 60

/**
 * Thủ tục lấy trực tiếp từ Cổng Dịch vụ công Quốc gia bằng
 * backend/scripts/scrape-dvc-quoc-gia.mjs (cổng chặn truy cập tự động nên cần trình duyệt thật).
 */
function loadPortalEntries(): LegalSeedEntry[] {
  if (!fs.existsSync(PORTAL_FILE)) {
    console.log(
      '(chưa có data/dvc-quoc-gia.json, bỏ qua dịch vụ công; chạy backend/scripts/scrape-dvc-quoc-gia.mjs để lấy)'
    )
    return []
  }
  const parsed = JSON.parse(fs.readFileSync(PORTAL_FILE, 'utf8')) as {
    procedures?: PortalProcedure[]
  }
  return (parsed.procedures ?? []).map(item => {
    const title =
      item.title.length > PORTAL_TITLE_MAX
        ? `${item.title.slice(0, PORTAL_TITLE_MAX - 1)}…`
        : item.title
    const issuer = [
      item.issuer,
      item.executor ? `thực hiện: ${item.executor}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
    return {
      url: item.href,
      title: `${title} (Cổng DVC Quốc gia, mã ${item.code})`,
      category: 'thu-tuc',
      issuer: `${issuer} (công bố trên Cổng Dịch vụ công Quốc gia)`,
      keywords: [
        'dịch vụ công',
        'thủ tục hành chính',
        item.code,
        item.field,
        item.query,
      ]
        .filter(Boolean)
        .map(keyword => keyword.slice(0, PORTAL_KEYWORD_MAX)),
      content: `${cleanPortalProcedure(item.text)}`,
    }
  })
}

/**
 * Nạp sẵn kho tri thức luật từ các nguồn công khai (xuất bản ngay).
 * Mặc định bỏ qua tài liệu đã có cùng sourceUrl.
 * `--dry`: chỉ kiểm tra tải được hay không, không ghi DB.
 * `--refresh`: tải lại và cập nhật nội dung, đơn vị, từ khoá của tài liệu đã có
 * (ngày giờ tải được ghi lại).
 */
async function bootstrap(dry: boolean, refresh: boolean): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })

  try {
    const service = app.get(LegalKnowledgeService)
    const existing = new Map(
      (await service.list()).flatMap(doc =>
        doc.sourceUrl ? [[doc.sourceUrl, doc._id] as const] : []
      )
    )
    let created = 0
    let refreshed = 0
    const failed: string[] = []

    const entries = [...LEGAL_SEED_ENTRIES, ...loadPortalEntries()]

    for (const entry of entries) {
      const existingId = existing.get(entry.url)
      if (existingId && !refresh) {
        console.log(`= bỏ qua (đã có): ${entry.title}`)
        continue
      }
      try {
        const raw =
          entry.content ??
          extractMainText((await fetchPageHtml(entry.url)).html).text
        const text = (entry.content ? raw : cleanSourceText(raw)).slice(
          0,
          LEGAL_CONTENT_MAX
        )
        if (text.length < LEGAL_CONTENT_MIN) {
          throw new Error('nội dung trích ra quá ngắn')
        }
        if (dry) {
          const head = text.slice(0, 90).replace(/\s+/g, ' ')
          console.log(`✓ [dry] ${entry.title} (${text.length} ký tự) | ${head}`)
          continue
        }
        if (existingId) {
          await service.update(existingId, {
            title: entry.title,
            category: entry.category,
            ...(entry.docNumber ? { docNumber: entry.docNumber } : {}),
            ...(entry.issuer ? { issuer: entry.issuer } : {}),
            keywords: entry.keywords,
            content: text,
            contentSource: 'link',
          })
          refreshed += 1
          console.log(`~ ${entry.title} (${text.length} ký tự)`)
          continue
        }
        await service.create({
          title: entry.title,
          category: entry.category,
          ...(entry.docNumber ? { docNumber: entry.docNumber } : {}),
          ...(entry.issuer ? { issuer: entry.issuer } : {}),
          sourceUrl: entry.url,
          keywords: entry.keywords,
          content: text,
          contentSource: 'link',
          status: 'published',
        })
        created += 1
        console.log(`+ ${entry.title} (${text.length} ký tự)`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failed.push(entry.url)
        console.error(`x ${entry.title}: ${message}`)
      }
    }

    console.log(
      `\nXong: thêm ${created}, làm mới ${refreshed}, lỗi ${failed.length}/${entries.length}`
    )
  } finally {
    await app.close()
  }
}

bootstrap(
  process.argv.includes('--dry'),
  process.argv.includes('--refresh')
).catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
