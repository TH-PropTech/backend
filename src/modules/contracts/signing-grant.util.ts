import { UnprocessableEntityException } from '@nestjs/common'
import { createHash, randomBytes } from 'node:crypto'

export type SigningRole = 'tenant' | 'landlord'

export type SigningGrantInput = {
  userId: string
  role: SigningRole
  contractId: string
  contentLockedHash: string
  biometricGrantId: string
  otpSessionId: string
}

export type SigningGrantRecord = SigningGrantInput & {
  tokenHash: string
  expiresAt: Date
  consumedAt: Date | null
}

export function createSigningGrant(
  input: SigningGrantInput,
  now: Date,
  ttlMs: number
): { grantId: string; record: SigningGrantRecord } {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new UnprocessableEntityException('INVALID_SIGNING_GRANT_TTL')
  }
  const grantId = `sg_${randomBytes(32).toString('hex')}`
  return {
    grantId,
    record: {
      ...input,
      tokenHash: hashGrantId(grantId),
      expiresAt: new Date(now.getTime() + ttlMs),
      consumedAt: null,
    },
  }
}

export function consumeSigningGrant(
  record: SigningGrantRecord,
  grantId: string,
  input: SigningGrantInput,
  now: Date
): SigningGrantRecord {
  const isValid =
    record.tokenHash === hashGrantId(grantId) &&
    record.consumedAt === null &&
    record.expiresAt.getTime() > now.getTime() &&
    record.userId === input.userId &&
    record.role === input.role &&
    record.contractId === input.contractId &&
    record.contentLockedHash === input.contentLockedHash

  if (!isValid) throw new UnprocessableEntityException('SIGNING_GRANT_INVALID')
  return { ...record, consumedAt: now }
}

export function hashGrantId(grantId: string): string {
  return createHash('sha256').update(grantId).digest('hex')
}
