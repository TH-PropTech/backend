import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { GridFSBucket, ObjectId } from 'mongodb'
import type { Readable } from 'node:stream'
import { DataSource } from 'typeorm'
import { getSharedMongoClient } from './shared-mongo-client'

export const CONTRACT_ARTIFACT_STORAGE = Symbol('CONTRACT_ARTIFACT_STORAGE')

export interface ContractArtifactStorage {
  upload(bytes: Buffer, filename: string): Promise<ObjectId>
  download(fileId: ObjectId): Promise<Buffer>
  /**
   * PROP-399 D8: đọc GridFS dạng stream (bộ nhớ có giới hạn) cho gói bằng chứng. Tùy chọn để các
   * storage giả lập hiện có không phải thay đổi; vắng mặt = không thể xuất gói.
   */
  openDownloadStream?(fileId: ObjectId): Promise<Readable>
}

@Injectable()
export class MongoGridFsArtifactStorage implements ContractArtifactStorage {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async upload(bytes: Buffer, filename: string): Promise<ObjectId> {
    const bucket = this.bucket()
    return new Promise<ObjectId>((resolve, reject) => {
      const stream = bucket.openUploadStream(filename, {
        contentType: 'application/pdf',
      })
      stream.once('error', reject)
      stream.once('finish', () => resolve(stream.id))
      stream.end(bytes)
    })
  }

  async download(fileId: ObjectId): Promise<Buffer> {
    const bucket = this.bucket()
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = bucket.openDownloadStream(fileId)
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.once('error', reject)
      stream.once('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  openDownloadStream(fileId: ObjectId): Promise<Readable> {
    // Promise.resolve().then: lỗi "client chưa sẵn sàng" vẫn trả về dạng rejection như trước.
    return Promise.resolve().then(() =>
      this.bucket().openDownloadStream(fileId)
    )
  }

  private bucket(): GridFSBucket {
    const client = getSharedMongoClient(this.dataSource)
    return new GridFSBucket(client.db(), { bucketName: 'contract_artifacts' })
  }
}
