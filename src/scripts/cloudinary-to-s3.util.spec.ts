import { ObjectId } from 'mongodb'

import {
  buildS3Key,
  collectCloudinaryUrls,
  countCloudinaryRefsByField,
  isCloudinaryUrl,
  rewriteUrls,
} from './cloudinary-to-s3.util'

const CLOUD = 'https://res.cloudinary.com/dehsnaot1/image/upload'
const A = `${CLOUD}/v1781535737/khach_ixjldr.jpg`
const B = `${CLOUD}/v1781535739/ngu_nquhie.jpg`
const S3_BASE = 'https://thproptech-bucket.s3.ap-southeast-1.amazonaws.com'

describe('isCloudinaryUrl', () => {
  it.each([
    [A, true],
    ['http://res.cloudinary.com/x/a.jpg', false],
    ['https://res.cloudinary.com.evil.com/a.jpg', false],
    [`${S3_BASE}/seed/a.jpg`, false],
    [42, false],
    [null, false],
  ])('classifies %s', (value, expected) => {
    expect(isCloudinaryUrl(value)).toBe(expected)
  })
})

describe('collectCloudinaryUrls', () => {
  it('finds urls in arrays and deeply nested documents', () => {
    const doc = {
      _id: new ObjectId(),
      createdAt: new Date(),
      gallery: [A, B, `${S3_BASE}/apartments/x.jpg`],
      messages: [{ metadata: { propertyCard: { image: A } } }],
      lines: [{ evidenceUrls: [B] }],
      title: 'Căn hộ',
      price: 1000,
      empty: null,
    }

    const found = collectCloudinaryUrls(doc)

    expect([...found].sort()).toEqual([A, B].sort())
  })

  it('returns an empty set when nothing matches', () => {
    expect(collectCloudinaryUrls({ a: ['x', 1, null, {}] }).size).toBe(0)
  })

  it('accumulates into a provided set', () => {
    const into = new Set<string>([A])

    collectCloudinaryUrls([B], into)

    expect(into.size).toBe(2)
  })
})

describe('buildS3Key', () => {
  it('keeps the original file name under the seed prefix', () => {
    expect(buildS3Key(A, new Map())).toBe('seed/khach_ixjldr.jpg')
  })

  it('returns the same key when asked again for the same url', () => {
    const taken = new Map<string, string>()

    const first = buildS3Key(A, taken)
    const second = buildS3Key(A, taken)

    expect(second).toBe(first)
  })

  it('prefixes the cloudinary version when two urls share a file name', () => {
    const taken = new Map<string, string>()
    const other = `${CLOUD}/v999/khach_ixjldr.jpg`

    const first = buildS3Key(A, taken)
    const second = buildS3Key(other, taken)

    expect(first).toBe('seed/khach_ixjldr.jpg')
    expect(second).toBe('seed/v999-khach_ixjldr.jpg')
  })

  it('adds a counter when version-prefixed names also collide', () => {
    const taken = new Map<string, string>()
    const one = `${CLOUD}/v1/a.jpg`
    const two = `${CLOUD}/folder/v1/a.jpg`
    const three = `${CLOUD}/other/v1/a.jpg`

    const keys = [one, two, three].map(url => buildS3Key(url, taken))

    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('seed/a.jpg')
    expect(keys[1]).toBe('seed/v1-a.jpg')
    expect(keys[2]).toBe('seed/v1-a.jpg-2')
  })

  it('handles urls without a version segment and encoded names', () => {
    const taken = new Map<string, string>()
    const first = buildS3Key(`${CLOUD}/folder/a%20b.png`, taken)
    const second = buildS3Key(`${CLOUD}/other/a%20b.png`, taken)

    expect(first).toBe('seed/a b.png')
    expect(second).toBe('seed/a b.png-2')
  })
})

describe('rewriteUrls', () => {
  const map = new Map([
    [A, `${S3_BASE}/seed/khach_ixjldr.jpg`],
    [B, `${S3_BASE}/seed/ngu_nquhie.jpg`],
  ])

  it('replaces matching strings at any depth and keeps other fields', () => {
    const id = new ObjectId()
    const doc = {
      _id: id,
      gallery: [A, 'https://other.example/x.jpg'],
      nested: { messages: [{ image: B }] },
      price: 5,
    }

    const result = rewriteUrls(doc, map)

    expect(result.changed).toBe(true)
    expect(result.value).toEqual({
      _id: id,
      gallery: [
        `${S3_BASE}/seed/khach_ixjldr.jpg`,
        'https://other.example/x.jpg',
      ],
      nested: { messages: [{ image: `${S3_BASE}/seed/ngu_nquhie.jpg` }] },
      price: 5,
    })
  })

  it('reports unchanged and returns the same object when nothing matches', () => {
    const doc = { gallery: ['https://other.example/x.jpg'], n: 1 }

    const result = rewriteUrls(doc, map)

    expect(result.changed).toBe(false)
    expect(result.value).toBe(doc)
  })

  it('leaves a cloudinary url that is missing from the map untouched', () => {
    const unknown = `${CLOUD}/v1/unknown.jpg`

    const result = rewriteUrls({ gallery: [unknown, A] }, map)

    expect(result.value.gallery).toEqual([
      unknown,
      `${S3_BASE}/seed/khach_ixjldr.jpg`,
    ])
  })

  it('does not mutate its input', () => {
    const doc = { gallery: [A] }

    rewriteUrls(doc, map)

    expect(doc.gallery).toEqual([A])
  })

  it('is idempotent once urls are rewritten', () => {
    const once = rewriteUrls({ gallery: [A] }, map)

    const twice = rewriteUrls(once.value, map)

    expect(twice.changed).toBe(false)
  })
})

describe('countCloudinaryRefsByField', () => {
  it('counts references per normalized field path', () => {
    const doc = {
      gallery: [A, B, A],
      images360: [B],
      lines: [{ evidenceUrls: [A] }, { evidenceUrls: [] }],
      messages: [{ metadata: { propertyCard: { image: A } } }],
      note: `${S3_BASE}/seed/x.jpg`,
    }

    const counts = countCloudinaryRefsByField(doc)

    expect(Object.fromEntries(counts)).toEqual({
      'gallery[]': 3,
      'images360[]': 1,
      'lines[].evidenceUrls[]': 1,
      'messages[].metadata.propertyCard.image': 1,
    })
  })

  it('returns an empty map for a document without references', () => {
    expect(countCloudinaryRefsByField({ a: [1, 'x'] }).size).toBe(0)
  })
})
