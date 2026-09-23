import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb'

export const CONTRACT_ARTIFACT_STORAGE = Symbol('CONTRACT_ARTIFACT_STORAGE')

export interface ContractArtifactStorage {
  upload(bytes: Buffer, filename: string): Promise<ObjectId>
  download(fileId: ObjectId): Promise<Buffer>
}

@Injectable()
export class MongoGridFsArtifactStorage
  implements ContractArtifactStorage, OnModuleDestroy
{
  private client: MongoClient | null = null
  private clientPromise: Promise<MongoClient> | null = null

  constructor(private readonly configService: ConfigService) {}

  async upload(bytes: Buffer, filename: string): Promise<ObjectId> {
    const bucket = await this.bucket()
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
    const bucket = await this.bucket()
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = bucket.openDownloadStream(fileId)
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.once('error', reject)
      stream.once('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.close()
    this.client = null
    this.clientPromise = null
  }

  private async bucket(): Promise<GridFSBucket> {
    const client = await this.getClient()
    return new GridFSBucket(client.db(), { bucketName: 'contract_artifacts' })
  }

  private async getClient(): Promise<MongoClient> {
    if (this.client) return this.client
    this.clientPromise ??= MongoClient.connect(
      this.configService.getOrThrow<string>('database.url')
    )
    this.client = await this.clientPromise
    return this.client
  }
}
