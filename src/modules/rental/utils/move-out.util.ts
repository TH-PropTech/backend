import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { LedgerEvidenceRef } from '../schemas/move-in-settlement.schema'
import {
  DEFAULT_MOVE_OUT_RESPONSE_DAYS,
  MAX_MOVE_OUT_RESPONSE_DAYS,
  MIN_MOVE_OUT_RESPONSE_DAYS,
} from './deposit-refund.constants'

export const DAY_MS = 24 * 60 * 60 * 1000
/** Nhắc chủ nhà và khách khi còn không quá khoảng này trước hạn hoàn cọc. */
export const REFUND_REMINDER_LEAD_MS = DAY_MS

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS)

/**
 * Đọc `packageSnapshot.moveOutPolicy.responseDays` một cách phòng thủ: gói cũ hoặc
 * giá trị ngoài khoảng cho phép rơi về mặc định.
 */
export function resolveMoveOutResponseDays(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) {
    return DEFAULT_MOVE_OUT_RESPONSE_DAYS
  }
  const policy = (snapshot as { moveOutPolicy?: unknown }).moveOutPolicy
  if (typeof policy !== 'object' || policy === null) {
    return DEFAULT_MOVE_OUT_RESPONSE_DAYS
  }
  const days = (policy as { responseDays?: unknown }).responseDays
  return typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= MIN_MOVE_OUT_RESPONSE_DAYS &&
    days <= MAX_MOVE_OUT_RESPONSE_DAYS
    ? days
    : DEFAULT_MOVE_OUT_RESPONSE_DAYS
}

export function pendingEvidence(
  manifestVersion: number,
  manifestHash: string
): LedgerEvidenceRef {
  return {
    manifestVersion,
    manifestHash,
    ledgerStatus: 'pending',
    txHash: null,
    blockNumber: null,
    recordedAt: new Date(),
  }
}

export async function loadContract(
  repo: Repository<Contract>,
  contractId: string
): Promise<Contract> {
  if (!ObjectId.isValid(contractId))
    throw new NotFoundException('CONTRACT_NOT_FOUND')
  const contract = await repo.findOne({
    where: { _id: new ObjectId(contractId) },
  })
  if (!contract) throw new NotFoundException('CONTRACT_NOT_FOUND')
  return contract
}

export const isPartyOf = (
  record: { tenantId: string; landlordId: string },
  actorId: string
): boolean => actorId === record.tenantId || actorId === record.landlordId

export function assertPartyOrStaff(
  record: { tenantId: string; landlordId: string },
  actorId: string,
  isStaff: boolean,
  code: string
): void {
  if (!isStaff && !isPartyOf(record, actorId))
    throw new ForbiddenException(code)
}
