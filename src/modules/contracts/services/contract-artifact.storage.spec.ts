import { ObjectId, MongoClient } from 'mongodb'
import { PassThrough } from 'node:stream'
import { MongoGridFsArtifactStorage } from './contract-artifact.storage'

const bucketCtor = vi.hoisted(() => vi.fn())
const bucketApi = vi.hoisted(() => ({
  openUploadStream: vi.fn(),
  openDownloadStream: vi.fn(),
}))

vi.mock('mongodb', async importOriginal => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: class {
      public constructor(db: unknown, options: unknown) {
        bucketCtor(db, options)
        return bucketApi
      }
    },
  }
})

function createFixture(): {
  storage: MongoGridFsArtifactStorage
  database: object
  client: { db: jest.Mock; close: jest.Mock }
  dataSource: { mongoManager: { mongoQueryRunner: unknown } }
  connectSpy: jest.SpyInstance
} {
  const database = {}
  const client = { db: jest.fn(() => database), close: jest.fn() }
  const dataSource = {
    mongoManager: { mongoQueryRunner: { databaseConnection: client } },
  }
  const connectSpy = jest
    .spyOn(MongoClient, 'connect')
    .mockRejectedValue(new Error('MongoClient.connect must not be called'))
  return {
    storage: new MongoGridFsArtifactStorage(dataSource as never),
    database,
    client,
    dataSource,
    connectSpy,
  }
}

describe('MongoGridFsArtifactStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    bucketCtor.mockClear()
    bucketApi.openUploadStream.mockReset()
    bucketApi.openDownloadStream.mockReset()
  })

  it('uploads through a contract_artifacts bucket built from the shared client', async () => {
    const fixture = createFixture()
    const fileId = new ObjectId()
    const upload = Object.assign(new PassThrough(), { id: fileId })
    bucketApi.openUploadStream.mockReturnValue(upload)
    upload.on('data', () => undefined)

    const result = await fixture.storage.upload(Buffer.from('pdf'), 'a.pdf')

    expect(result).toBe(fileId)
    expect(bucketCtor).toHaveBeenCalledWith(fixture.database, {
      bucketName: 'contract_artifacts',
    })
    expect(bucketApi.openUploadStream).toHaveBeenCalledWith('a.pdf', {
      contentType: 'application/pdf',
    })
    expect(fixture.connectSpy).not.toHaveBeenCalled()
  })

  it('rejects upload when the stream errors', async () => {
    const fixture = createFixture()
    const upload = Object.assign(new PassThrough(), { id: new ObjectId() })
    bucketApi.openUploadStream.mockReturnValue(upload)
    upload.on('data', () => undefined)

    const pending = fixture.storage.upload(Buffer.from('pdf'), 'a.pdf')
    await Promise.resolve()
    await Promise.resolve()
    upload.emit('error', new Error('gridfs failed'))

    await expect(pending).rejects.toThrow('gridfs failed')
  })

  it('downloads the whole file as one buffer', async () => {
    const fixture = createFixture()
    const download = new PassThrough()
    bucketApi.openDownloadStream.mockReturnValue(download)

    const pending = fixture.storage.download(new ObjectId())
    await Promise.resolve()
    await Promise.resolve()
    download.write(Buffer.from('ab'))
    download.end(Buffer.from('cd'))

    await expect(pending).resolves.toEqual(Buffer.from('abcd'))
  })

  it('rejects download when the stream errors', async () => {
    const fixture = createFixture()
    const download = new PassThrough()
    bucketApi.openDownloadStream.mockReturnValue(download)

    const pending = fixture.storage.download(new ObjectId())
    await Promise.resolve()
    await Promise.resolve()
    download.emit('error', new Error('missing file'))

    await expect(pending).rejects.toThrow('missing file')
  })

  it('exposes a download stream for evidence export', async () => {
    const fixture = createFixture()
    const download = new PassThrough()
    bucketApi.openDownloadStream.mockReturnValue(download)

    await expect(
      fixture.storage.openDownloadStream(new ObjectId())
    ).resolves.toBe(download)
  })

  it('fails with a clear error when the shared client is not ready', async () => {
    const fixture = createFixture()
    fixture.dataSource.mongoManager.mongoQueryRunner = undefined

    await expect(fixture.storage.download(new ObjectId())).rejects.toThrow(
      'MongoDB client chưa sẵn sàng'
    )
    expect(bucketCtor).not.toHaveBeenCalled()
    expect(fixture.connectSpy).not.toHaveBeenCalled()
  })

  it('has no module-destroy hook and never closes the shared client', async () => {
    const fixture = createFixture()
    bucketApi.openDownloadStream.mockReturnValue(new PassThrough())
    await fixture.storage.openDownloadStream(new ObjectId())

    expect(fixture.storage).not.toHaveProperty('onModuleDestroy')
    expect(fixture.client.close).not.toHaveBeenCalled()
  })
})
