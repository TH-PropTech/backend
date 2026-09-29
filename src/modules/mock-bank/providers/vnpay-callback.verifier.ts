import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'node:crypto'

type VnpayQuery = Record<string, string | string[] | undefined>

@Injectable()
export class VnpayCallbackVerifier {
  verify(
    query: VnpayQuery,
    expected: { secret: string; txRef: string; amount: number }
  ): { txRef: string; amount: number; succeeded: boolean } {
    const signature = getQueryValue(query, 'vnp_SecureHash')
    const txRef = getQueryValue(query, 'vnp_TxnRef')
    const amountMinor = getQueryValue(query, 'vnp_Amount')
    const responseCode = getQueryValue(query, 'vnp_ResponseCode')
    if (!signature || !txRef || !amountMinor || !responseCode) {
      throw new BadRequestException('INVALID_VNPAY_CALLBACK')
    }
    const expectedSignature = createHmac('sha512', expected.secret)
      .update(canonicalQuery(query))
      .digest('hex')
    if (!sameSignature(signature, expectedSignature)) {
      throw new BadRequestException('INVALID_VNPAY_SIGNATURE')
    }
    if (txRef !== expected.txRef) {
      throw new ConflictException('VNPAY_TRANSACTION_MISMATCH')
    }
    if (!/^\d+$/.test(amountMinor)) {
      throw new BadRequestException('INVALID_VNPAY_AMOUNT')
    }
    const minor = Number(amountMinor)
    if (!Number.isSafeInteger(minor) || minor / 100 !== expected.amount) {
      throw new ConflictException('VNPAY_AMOUNT_MISMATCH')
    }
    return { txRef, amount: expected.amount, succeeded: responseCode === '00' }
  }
}

function getQueryValue(query: VnpayQuery, key: string): string | null {
  const value = query[key]
  return typeof value === 'string' ? value : null
}

function canonicalQuery(query: VnpayQuery): string {
  return Object.entries(query)
    .filter(([key]) => key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType')
    .map(([key]) => [key, getQueryValue(query, key)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, '+')}`
    )
    .join('&')
}

function sameSignature(received: string, expected: string): boolean {
  const actualBuffer = Buffer.from(received, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}
