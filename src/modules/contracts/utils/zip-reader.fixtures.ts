import { inflateRawSync } from 'node:zlib'

/**
 * Trình đọc ZIP tối giản CHỈ cho test (không dependency): đọc central directory rồi giải nén
 * entry stored/deflate, đủ để chứng minh một vòng ghi–đọc thật với archiver.
 */
export type ReadZipEntry = {
  name: string
  method: number
  data: Buffer
}

export function readZip(buffer: Buffer): ReadZipEntry[] {
  let eocd = -1
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP end-of-central-directory not found')

  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries: ReadZipEntry[] = []

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP central directory entry corrupt')
    }
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8')

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('ZIP local header corrupt')
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressedSize)
    entries.push({
      name,
      method,
      data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
