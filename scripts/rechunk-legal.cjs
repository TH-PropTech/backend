/**
 * Cắt lại (re-chunk) toàn bộ văn bản trong kho tri thức pháp lý bằng bộ cắt hiện tại.
 *
 * Dùng khi đổi logic cắt (`legal-chunker`): `legal_knowledge_chunks` chỉ là dữ liệu dẫn xuất từ
 * `legal_documents.content`, nên có thể dựng lại bất kỳ lúc nào mà không mất nội dung gốc.
 *
 *   node scripts/rechunk-legal.cjs                       # chạy thử: chỉ in so sánh, KHÔNG ghi
 *   node scripts/rechunk-legal.cjs --apply --backup f.json   # ghi; sao lưu chunk cũ ra f.json trước
 *   node scripts/rechunk-legal.cjs --restore f.json          # khôi phục chunk cũ từ bản sao lưu
 *
 * Cần đã build (`dist/`). Đọc DATABASE_URL (và NODE_DNS_SERVERS) từ `.env`.
 */
const dns = require('dns')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const has = flag => args.includes(flag)
const valueOf = flag => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

const root = path.join(__dirname, '..')
const env = fs.existsSync(path.join(root, '.env'))
  ? fs.readFileSync(path.join(root, '.env'), 'utf8')
  : ''
const fromEnv = key =>
  process.env[key] ??
  (env.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim()

const dnsServers = (fromEnv('NODE_DNS_SERVERS') || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
if (dnsServers.length > 0) {
  dns.setServers(dnsServers)
  dns.promises.setServers(dnsServers)
}

const { MongoClient, ObjectId } = require('mongodb')
const {
  chunkLegalText,
} = require('../dist/modules/legal/utils/legal-chunker.js')

async function main() {
  const url = fromEnv('DATABASE_URL')
  if (!url) throw new Error('Thiếu DATABASE_URL')
  const client = await MongoClient.connect(url, {
    serverSelectionTimeoutMS: 15000,
  })
  const db = client.db()
  const docsCol = db.collection('legal_documents')
  const chunksCol = db.collection('legal_knowledge_chunks')

  try {
    const restoreFile = valueOf('--restore')
    if (restoreFile) {
      const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf8'))
      for (const entry of backup.docs) {
        await chunksCol.deleteMany({ docId: entry.docId })
        if (entry.chunks.length > 0) {
          await chunksCol.insertMany(
            entry.chunks.map(c => ({ ...c, _id: new ObjectId(c._id) }))
          )
        }
        await docsCol.updateOne(
          { _id: new ObjectId(entry.docId) },
          { $set: { chunkCount: entry.chunks.length } }
        )
      }
      console.log(
        `Đã khôi phục chunk của ${backup.docs.length} văn bản từ ${restoreFile}`
      )
      return
    }

    const apply = has('--apply')
    const backupFile = valueOf('--backup')
    if (apply && !backupFile)
      throw new Error('--apply cần --backup <file.json> để có đường lui')

    const docs = await docsCol
      .find({ content: { $type: 'string', $ne: '' } })
      .toArray()
    const plan = []
    for (const doc of docs) {
      const docId = String(doc._id)
      const oldChunks = await chunksCol
        .find({ docId })
        .sort({ order: 1 })
        .toArray()
      const next = chunkLegalText(doc.content)
      const same =
        oldChunks.length === next.length &&
        oldChunks.every(
          (c, i) =>
            c.text === next[i].text &&
            (c.heading ?? '') === (next[i].heading ?? '')
        )
      plan.push({ doc, docId, oldChunks, next, same })
    }

    const changed = plan.filter(p => !p.same)
    console.log(
      `${plan.length} văn bản có nội dung, ${changed.length} cần cắt lại`
    )
    for (const p of changed) {
      const wrapped = p.oldChunks.filter(
        c =>
          c.text.split('\n').length > 6 &&
          c.text.length / c.text.split('\n').length < 100
      ).length
      console.log(
        `  ${p.doc.status ?? '-'}\t${String(p.oldChunks.length).padStart(4)} -> ${String(p.next.length).padStart(4)}\t(${wrapped} chunk cũ bị ngắt dòng)\t${p.doc.title}`
      )
    }

    if (!apply) {
      console.log(
        '\nChạy thử, chưa ghi gì. Thêm --apply --backup <file.json> để áp dụng.'
      )
      return
    }

    fs.writeFileSync(
      backupFile,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        docs: changed.map(p => ({
          docId: p.docId,
          title: p.doc.title,
          chunks: p.oldChunks.map(c => ({ ...c, _id: String(c._id) })),
        })),
      })
    )
    console.log(
      `\nĐã sao lưu chunk cũ của ${changed.length} văn bản vào ${backupFile}`
    )

    for (const p of changed) {
      await chunksCol.deleteMany({ docId: p.docId })
      if (p.next.length > 0) {
        await chunksCol.insertMany(
          p.next.map(c => ({
            docId: p.docId,
            order: c.order,
            ...(c.heading ? { heading: c.heading } : {}),
            text: c.text,
          }))
        )
      }
      await docsCol.updateOne(
        { _id: p.doc._id },
        { $set: { chunkCount: p.next.length } }
      )
    }
    console.log(
      `Đã cắt lại ${changed.length} văn bản. Chỉ mục tìm kiếm tự làm mới trong vòng 60 giây (hoặc khởi động lại backend).`
    )
  } finally {
    await client.close()
  }
}

main().catch(error => {
  console.error('Lỗi:', error.message)
  process.exit(1)
})
