import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto'

/** Minimum length of GROQ_KEY_ENCRYPTION_SECRET. */
export const GROQ_KEY_SECRET_MIN_LENGTH = 32

const HKDF_SALT = 'th-proptech-groq'
const KEY_BYTES = 32
const IV_BYTES = 12

type DerivedPurpose = 'enc' | 'idx'

/** Derives a purpose-specific 256-bit key so encryption and hashing never share key material. */
function deriveKey(secret: string, purpose: DerivedPurpose): Buffer {
  if (secret.length < GROQ_KEY_SECRET_MIN_LENGTH) {
    throw new Error(
      `GROQ_KEY_ENCRYPTION_SECRET phải có ít nhất ${GROQ_KEY_SECRET_MIN_LENGTH} ký tự`
    )
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'utf8'),
      HKDF_SALT,
      purpose,
      KEY_BYTES
    )
  )
}

/** AES-256-GCM. Output format: base64url(iv).base64url(tag).base64url(ciphertext). */
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'enc'), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map(part => part.toString('base64url')).join('.')
}

/** Throws when the blob is malformed or was tampered with (GCM auth failure). */
export function decrypt(blob: string, secret: string): string {
  const parts = blob.split('.')
  if (parts.length !== 3) {
    throw new Error('Định dạng khoá mã hoá không hợp lệ')
  }
  const [iv, tag, ciphertext] = parts.map(part =>
    Buffer.from(part, 'base64url')
  ) as [Buffer, Buffer, Buffer]
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, 'enc'), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}

/** Keyed fingerprint (HMAC-SHA256) used for dedupe and lookup without storing the raw key. */
export function keyHash(key: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret, 'idx'))
    .update(key, 'utf8')
    .digest('hex')
}

/** Display mask, e.g. "gsk_abcd...wxyz". */
export function maskKey(key: string): string {
  return `${key.slice(0, 8)}...${key.slice(-4)}`
}
