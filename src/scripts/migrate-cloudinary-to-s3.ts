/* eslint-disable no-console */
import type { ConfigService } from '@nestjs/config'
import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { setServers } from 'node:dns'
import { BSON, MongoClient, type Document, type ObjectId } from 'mongodb'

import { StorageService } from '../common/storage/storage.service'
import { configuration } from '../config/configuration'
import {
  buildS3Key,
  collectCloudinaryUrls,
  countCloudinaryRefsByField,
  rewriteUrls,
} from './cloudinary-to-s3.util'

const COLLECTIONS = [
  'apartments',
  'buildings_removed_backup',
  'deposit_settlement_statements',
  'ai_chats',
] as const
const FETCH_ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 30_000
const OUTPUT_DIR = path.resolve(process.cwd(), '.tmp')
const MAP_FILE = path.join(OUTPUT_DIR, 'cloudinary-to-s3-map.json')

interface MigrationFailure {
  readonly url: string
  readonly reason: string
}

function createStorage(): StorageService {
  const settings = configuration().storage
  const values: Record<string, string> = {
    'storage.region': settings.region,
    'storage.bucket': settings.bucket,
    'storage.accessKeyId': settings.accessKeyId,
    'storage.secretAccessKey': settings.secretAccessKey,
    'storage.publicBaseUrl': settings.publicBaseUrl,
  }
  return new StorageService({
    get: (key: string): string | undefined => values[key],
  } as unknown as ConfigService)
}

async function downloadImage(
  url: string
): Promise<{ body: Buffer; contentType: string }> {
  let lastError = 'unknown error'
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType:
          response.headers.get('content-type') ?? 'application/octet-stream',
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError)
}

async function copyToStorage(
  storage: StorageService,
  url: string,
  key: string
): Promise<void> {
  const { body, contentType } = await downloadImage(url)
  let lastError = 'unknown error'
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      await storage.putObject({ key, body, contentType })
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(lastError)
}

async function scan(
  client: MongoClient
): Promise<{ urls: Set<string>; docsByCollection: Map<string, Document[]> }> {
  const urls = new Set<string>()
  const docsByCollection = new Map<string, Document[]>()
  for (const name of COLLECTIONS) {
    const affected: Document[] = []
    const fieldCounts = new Map<string, number>()
    const collectionUrls = new Set<string>()
    let total = 0
    for await (const doc of client.db().collection(name).find({})) {
      total += 1
      const found = collectCloudinaryUrls(doc)
      if (found.size === 0) continue
      affected.push(doc)
      for (const url of found) {
        urls.add(url)
        collectionUrls.add(url)
      }
      countCloudinaryRefsByField(doc, fieldCounts)
    }
    docsByCollection.set(name, affected)
    console.log(
      `${name}: ${affected.length}/${total} documents, ${collectionUrls.size} unique urls`
    )
    for (const [field, count] of fieldCounts) {
      console.log(`  ${field}: ${count} references`)
    }
  }
  return { urls, docsByCollection }
}

async function backup(client: MongoClient, stamp: string): Promise<string> {
  const dir = path.join(OUTPUT_DIR, `backup-${stamp}`)
  await mkdir(dir, { recursive: true })
  for (const name of COLLECTIONS) {
    const docs = await client.db().collection(name).find({}).toArray()
    await writeFile(
      path.join(dir, `${name}.json`),
      BSON.EJSON.stringify(docs, undefined, 2, { relaxed: false })
    )
  }
  return dir
}

async function copyAll(
  storage: StorageService,
  urls: Set<string>
): Promise<{ map: Map<string, string>; failures: MigrationFailure[] }> {
  const taken = new Map<string, string>()
  const map = new Map<string, string>()
  const failures: MigrationFailure[] = []
  for (const url of urls) {
    const key = buildS3Key(url, taken)
    try {
      await copyToStorage(storage, url, key)
      map.set(url, storage.publicUrl(key))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push({ url, reason })
    }
  }
  return { map, failures }
}

async function rewriteDatabase(
  client: MongoClient,
  docsByCollection: Map<string, Document[]>,
  map: ReadonlyMap<string, string>
): Promise<number> {
  let updated = 0
  for (const [name, docs] of docsByCollection) {
    for (const doc of docs) {
      const { _id: rawId, ...fields } = doc
      const _id = rawId as ObjectId
      const changes: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(fields)) {
        const result = rewriteUrls(value, map)
        if (result.changed) changes[field] = result.value
      }
      if (Object.keys(changes).length === 0) continue
      await client.db().collection(name).updateOne({ _id }, { $set: changes })
      updated += 1
    }
  }
  return updated
}

async function run(write: boolean): Promise<number> {
  if (process.env.MIGRATE_FORCE_PUBLIC_DNS === 'true') {
    setServers(['8.8.8.8', '1.1.1.1'])
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  const storage = createStorage()
  if (!storage.isConfigured) {
    throw new Error('S3 is not configured (AWS_REGION/AWS_S3_BUCKET)')
  }

  const client = await new MongoClient(databaseUrl).connect()
  try {
    const { urls, docsByCollection } = await scan(client)
    console.log(`Unique Cloudinary urls: ${urls.size}`)
    if (!write) {
      const taken = new Map<string, string>()
      for (const url of urls) {
        console.log(`  ${url} -> ${storage.publicUrl(buildS3Key(url, taken))}`)
      }
      console.log('Dry run only. Re-run with --write to migrate.')
      return 0
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    console.log(`Backup written to ${await backup(client, stamp)}`)
    const { map, failures } = await copyAll(storage, urls)
    await mkdir(OUTPUT_DIR, { recursive: true })
    await writeFile(
      MAP_FILE,
      JSON.stringify(Object.fromEntries(map), undefined, 2)
    )
    console.log(`Copied ${map.size}/${urls.size} images. Map: ${MAP_FILE}`)
    const updated = await rewriteDatabase(client, docsByCollection, map)
    console.log(`Updated ${updated} documents.`)
    for (const failure of failures) {
      console.error(`FAILED ${failure.url}: ${failure.reason}`)
    }
    return failures.length === 0 ? 0 : 1
  } finally {
    await client.close()
  }
}

const write = process.argv.slice(2).includes('--write')
run(write)
  .then(code => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`migrate-cloudinary-to-s3 failed: ${message}`)
    process.exitCode = 1
  })
