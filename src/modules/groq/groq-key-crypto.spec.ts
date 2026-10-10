import { decrypt, encrypt, keyHash, maskKey } from './groq-key-crypto'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)
const RAW_KEY = 'gsk_abcdefghijklmnopqrstuvwxyz0123'

describe('groq-key-crypto', () => {
  it('round-trips a key through encrypt/decrypt', () => {
    const blob = encrypt(RAW_KEY, SECRET)
    expect(decrypt(blob, SECRET)).toBe(RAW_KEY)
  })

  it('produces a three-part base64url blob without the plaintext', () => {
    const blob = encrypt(RAW_KEY, SECRET)
    const parts = blob.split('.')
    expect(parts).toHaveLength(3)
    expect(blob).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(blob).not.toContain(RAW_KEY)
  })

  it('uses a fresh IV for every encryption', () => {
    expect(encrypt(RAW_KEY, SECRET)).not.toBe(encrypt(RAW_KEY, SECRET))
  })

  it('fails to decrypt with a different secret', () => {
    const blob = encrypt(RAW_KEY, SECRET)
    expect(() => decrypt(blob, OTHER_SECRET)).toThrow()
  })

  it('detects tampering with the ciphertext', () => {
    const [iv, tag, ciphertext] = encrypt(RAW_KEY, SECRET).split('.')
    const flipped = ciphertext!.startsWith('A')
      ? `B${ciphertext!.slice(1)}`
      : `A${ciphertext!.slice(1)}`
    expect(() => decrypt([iv, tag, flipped].join('.'), SECRET)).toThrow()
  })

  it('rejects a malformed blob', () => {
    expect(() => decrypt('not-a-blob', SECRET)).toThrow()
  })

  it('rejects a secret shorter than 32 characters', () => {
    expect(() => encrypt(RAW_KEY, 'short')).toThrow(/32 ký tự/)
    expect(() => keyHash(RAW_KEY, 'short')).toThrow(/32 ký tự/)
  })

  it('computes a stable dedupe hash that depends on the secret', () => {
    const hash = keyHash(RAW_KEY, SECRET)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(keyHash(RAW_KEY, SECRET)).toBe(hash)
    expect(keyHash(RAW_KEY, OTHER_SECRET)).not.toBe(hash)
    expect(keyHash('gsk_otherotherotherother0000', SECRET)).not.toBe(hash)
  })

  it('masks a key for display', () => {
    expect(maskKey(RAW_KEY)).toBe('gsk_abcd...0123')
  })
})
