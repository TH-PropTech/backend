import { ObjectId } from 'mongodb'
import type { Repository } from 'typeorm'
import type { Contract } from '../../contracts/schemas/contract.schema'
import type { DepositAgreement } from '../../contracts/schemas/deposit-agreement.schema'
import type { Payment } from '../../payments/schemas/payment.schema'
import type { MoveInSettlement } from '../../rental/schemas/move-in-settlement.schema'
import type { FabricGovernanceSnapshot } from '../schemas/fabric-governance-snapshot.schema'
import type { LedgerReconciliationScope } from '../schemas/ledger-reconciliation-run.schema'

/**
 * PROP-399 D7: nguồn "sự kiện nghiệp vụ kỳ vọng" cho đối soát. Mỗi nguồn đọc bản ghi nghiệp vụ
 * thật (MongoDB là source of truth), phân trang theo `_id`, và nói rõ có đọc trực tiếp được trên
 * ledger không. Không bao giờ quét world state.
 */
export type ExpectedEvent = {
  eventType: string
  aggregateType: string
  aggregateId: string
  contractId: string | null
  expectedHash: string | null
  projection: 'confirmed' | 'pending' | 'failed' | 'missing'
}

type SourcePage = { rows: ExpectedEvent[]; lastId: string | null }

export type ReconciliationSource = {
  eventType: string
  aggregateType: string
  /** Tiền tố khoá ledger dùng cho phát hiện orphan (allowlist của chaincode). */
  ledgerPrefix: string | null
  /** Có đọc trực tiếp bằng khoá không; null = chaincode chưa có hàm đọc (chỉ so outbox/projection). */
  ledgerRead: { action: string; hashField: string } | null
  /** Phiên bản manifest/bằng chứng kỳ vọng — thành phần của fingerprint. */
  evidenceVersion: number
  page(input: {
    scope: LedgerReconciliationScope
    afterId: string | null
    take: number
  }): Promise<{ rows: ExpectedEvent[]; lastId: string | null }>
  ownerExists(id: string): Promise<boolean>
}

export const RECONCILIATION_EVENT_TYPES = [
  'contract.activated',
  'deposit.paid',
  'payment.paid',
  'governance.published',
  'move-in.settled',
  'handover.completed',
] as const

type Where = Record<string, unknown>
const asWhere = (where: Where): never => where as never
const LEDGER_STATES = ['pending', 'confirmed', 'failed']

function objectIds(ids: string[]): ObjectId[] {
  return ids.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id))
}

function projectionOf(
  value: string | null | undefined
): ExpectedEvent['projection'] {
  if (!value) return 'missing'
  if (value.startsWith('confirmed')) return 'confirmed'
  if (value === 'failed' || value === 'failed-terminal') return 'failed'
  return 'pending'
}

function pageClauses(
  scope: LedgerReconciliationScope,
  afterId: string | null,
  options: {
    dateField: string
    contractField: string | null
    extra: Where[]
  }
): Where {
  const clauses: Where[] = [...options.extra]
  if (afterId && ObjectId.isValid(afterId)) {
    clauses.push({ _id: { $gt: new ObjectId(afterId) } })
  }
  if (scope.from || scope.to) {
    clauses.push({
      [options.dateField]: {
        ...(scope.from ? { $gte: scope.from } : {}),
        ...(scope.to ? { $lte: scope.to } : {}),
      },
    })
  }
  if (scope.contractIds?.length && options.contractField) {
    clauses.push({
      [options.contractField]:
        options.contractField === '_id'
          ? { $in: objectIds(scope.contractIds) }
          : { $in: scope.contractIds },
    })
  }
  return { $and: clauses }
}

async function ownerById(
  repository: Repository<{ _id: ObjectId }>,
  id: string
): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false
  const row = await repository.findOne({
    where: asWhere({ _id: new ObjectId(id) }),
  })
  return Boolean(row)
}

export function buildReconciliationSources(repos: {
  contracts: Repository<Contract>
  deposits: Repository<DepositAgreement>
  payments: Repository<Payment>
  settlements: Repository<MoveInSettlement>
  snapshots: Repository<FabricGovernanceSnapshot>
}): ReconciliationSource[] {
  return [
    {
      eventType: 'contract.activated',
      aggregateType: 'contract',
      ledgerPrefix: 'CONTRACT_',
      ledgerRead: { action: 'readContract', hashField: 'contractHash' },
      evidenceVersion: 2,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        const rows = await repos.contracts.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'createdAt',
              contractField: '_id',
              extra: [
                { contractHash: { $ne: null } },
                { ledgerStatus: { $in: LEDGER_STATES } },
              ],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'contract.activated',
            aggregateType: 'contract',
            aggregateId: row._id.toHexString(),
            contractId: row._id.toHexString(),
            expectedHash: row.contractHash ?? null,
            projection: projectionOf(row.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.contracts, id),
    },
    {
      eventType: 'deposit.paid',
      aggregateType: 'deposit',
      ledgerPrefix: 'DEPOSIT_',
      ledgerRead: null,
      evidenceVersion: 1,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        const rows = await repos.deposits.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'createdAt',
              contractField: 'linkedLeaseContractId',
              extra: [
                { depositHash: { $ne: null } },
                { ledgerStatus: { $in: LEDGER_STATES } },
              ],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'deposit.paid',
            aggregateType: 'deposit',
            aggregateId: row._id.toHexString(),
            contractId: row.linkedLeaseContractId ?? null,
            expectedHash: row.depositHash ?? null,
            projection: projectionOf(row.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.deposits, id),
    },
    {
      eventType: 'payment.paid',
      aggregateType: 'payment',
      ledgerPrefix: 'PAYMENT_',
      ledgerRead: null,
      evidenceVersion: 1,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        const rows = await repos.payments.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'paidAt',
              contractField: 'contractId',
              extra: [
                { status: 'paid' },
                { paymentHash: { $ne: null } },
                { ledgerStatus: { $in: LEDGER_STATES } },
              ],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'payment.paid',
            aggregateType: 'payment',
            aggregateId: row._id.toHexString(),
            contractId: row.contractId ?? null,
            expectedHash: row.paymentHash ?? null,
            projection: projectionOf(row.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.payments, id),
    },
    {
      eventType: 'governance.published',
      aggregateType: 'governance-snapshot',
      ledgerPrefix: 'GOVERNANCE_',
      ledgerRead: {
        action: 'readGovernanceSnapshot',
        hashField: 'manifestHash',
      },
      evidenceVersion: 1,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        // Snapshot không gắn với hợp đồng: phạm vi chỉ có contractIds thì không bao gồm.
        if (scope.contractIds?.length && !scope.from && !scope.to) {
          return { rows: [], lastId: null }
        }
        const rows = await repos.snapshots.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'createdAt',
              contractField: null,
              extra: [{ status: 'published' }],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'governance.published',
            aggregateType: 'governance-snapshot',
            aggregateId: row._id.toHexString(),
            contractId: null,
            expectedHash: row.manifestHash,
            projection: projectionOf(row.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.snapshots, id),
    },
    {
      eventType: 'move-in.settled',
      aggregateType: 'move-in-settlement',
      ledgerPrefix: 'MOVEIN_',
      ledgerRead: { action: 'readMoveInSettlement', hashField: 'manifestHash' },
      evidenceVersion: 1,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        const rows = await repos.settlements.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'createdAt',
              contractField: 'contractId',
              extra: [{ status: 'paid' }],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'move-in.settled',
            aggregateType: 'move-in-settlement',
            aggregateId: row._id.toHexString(),
            contractId: row.contractId ?? null,
            expectedHash: row.settlementEvidence?.manifestHash ?? null,
            projection: projectionOf(row.settlementEvidence?.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.settlements, id),
    },
    {
      eventType: 'handover.completed',
      aggregateType: 'move-in-handover',
      ledgerPrefix: 'HANDOVER_',
      ledgerRead: { action: 'readHandover', hashField: 'handoverHash' },
      evidenceVersion: 1,
      async page({ scope, afterId, take }): Promise<SourcePage> {
        const rows = await repos.settlements.find({
          where: asWhere(
            pageClauses(scope, afterId, {
              dateField: 'createdAt',
              contractField: 'contractId',
              extra: [{ 'handover.completedAt': { $ne: null } }],
            })
          ),
          order: { _id: 'ASC' },
          take,
        })
        return {
          rows: rows.map(row => ({
            eventType: 'handover.completed',
            aggregateType: 'move-in-handover',
            aggregateId: row._id.toHexString(),
            contractId: row.contractId ?? null,
            // Chaincode lưu handoverHash (không phải manifestHash của bằng chứng).
            expectedHash: row.handover?.handoverHash ?? null,
            projection: projectionOf(row.handoverEvidence?.ledgerStatus),
          })),
          lastId: rows.at(-1)?._id.toHexString() ?? null,
        }
      },
      ownerExists: id => ownerById(repos.settlements, id),
    },
  ]
}
