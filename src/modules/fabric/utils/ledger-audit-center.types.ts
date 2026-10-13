/**
 * PROP-399 D6/D9: kiểu dữ liệu và hàm thuần của Audit Center read model. Mọi giá trị ở đây đã
 * được khử nhạy cảm: không args outbox, không lỗi thô, không credential/chứng chỉ, không PII.
 */

export const AUDIT_EVENT_TYPES = [
  'contract.activated',
  'deposit.paid',
  'payment.paid',
  'contract.amendment-effective',
  'contract.terminated',
  'governance.published',
  'move-in.settled',
  'handover.completed',
] as const

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

export const AUDIT_DELIVERY_STATES = [
  'pending',
  'processing',
  'retryable',
  'confirmed',
  'failed',
] as const
export type AuditDeliveryState = (typeof AUDIT_DELIVERY_STATES)[number]

export const AUDIT_VERIFICATION_STATES = [
  'verified',
  'mismatch',
  'unavailable',
  'not-recorded',
] as const
export type AuditVerificationState = (typeof AUDIT_VERIFICATION_STATES)[number]

export type AuditEventFilters = {
  page: number
  limit: number
  contractId?: string | undefined
  eventType?: string | undefined
  state?: AuditDeliveryState | undefined
  verificationState?: AuditVerificationState | undefined
  from?: string | undefined
  to?: string | undefined
  txId?: string | undefined
}

export type AuditEventSummary = {
  id: string
  eventType: string
  aggregateType: string
  aggregateRef: string
  contractId: string | null
  status: AuditDeliveryState
  verificationState: AuditVerificationState
  networkMode: 'fabric' | 'simulation'
  txId: string | null
  blockNumber: number | null
  explorerUrl: string | null
  payloadHash: string
  attempts: number
  failureCode: string | null
  createdAt: string
  updatedAt: string
  recordedAt: string | null
}

export type AuditExplorerAction = {
  available: boolean
  url: string | null
  reason:
    | null
    | 'EXPLORER_NOT_CONFIGURED'
    | 'EXPLORER_DEGRADED'
    | 'NOT_COMMITTED_ON_FABRIC'
}

export type AuditEventDetail = AuditEventSummary & {
  dependencies: Array<{
    key: string
    state: 'confirmed' | 'pending' | 'processing' | 'failed' | 'missing'
  }>
  explorer: AuditExplorerAction
  verification: {
    status: AuditVerificationState
    reason: string | null
  }
}

export type AuditEventPage = {
  items: AuditEventSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type AuditOverview = {
  generatedAt: string
  runtime: {
    mode: 'simulation' | 'fabric'
    state: 'simulation' | 'live' | 'degraded' | 'unavailable'
    ready: boolean
    connectionState: 'disabled' | 'connected' | 'unavailable'
    abiVersion: number | null
    evidenceSchemaVersions: number[]
    errorCodes: string[]
  }
  outbox: {
    pending: number
    processing: number
    retryable: number
    succeeded: number
    terminalFailure: number
    oldestPendingAt: string | null
    oldestPendingAgeSeconds: number | null
    oldestTerminalFailureAt: string | null
    oldestTerminalFailureAgeSeconds: number | null
  }
  worker: AuditWorkerHealth
  ledger: {
    height: number | null
    currentBlockHash: string | null
    observedAt: string | null
  }
  identityWarnings: Array<{
    role: 'writer' | 'reader' | 'operator'
    state: 'expiring' | 'expired'
    expiresAt: string | null
  }>
  explorer: {
    enabled: boolean
    state: 'disabled' | 'ready' | 'degraded'
    available: boolean
    reason: AuditExplorerAction['reason']
  }
  coverage: Array<{
    eventType: string
    total: number
    pending: number
    confirmed: number
    failed: number
  }>
  reconciliation: {
    latestRun: {
      id: string
      status: string
      startedAt: string | null
      completedAt: string | null
      counters: {
        examined: number
        consistent: number
        findings: number
        unverifiable: number
      }
    } | null
    openFindings: number
  }
}

export type AuditWorkerHealth = {
  state: 'ready' | 'degraded'
  oldestPendingAt: string | null
}

/** Ngưỡng item pending lâu bất thường mới coi worker là degraded (giây). */
export const AUDIT_WORKER_STALE_SECONDS = 600

/** Trạng thái giao nhận hiển thị từ trạng thái outbox (retryable = pending đã từng thất bại). */
export function deliveryState(row: {
  status: string
  attempts?: number | null
}): AuditDeliveryState {
  if (row.status === 'confirmed') return 'confirmed'
  if (row.status === 'failed') return 'failed'
  if (row.status === 'processing') return 'processing'
  return (row.attempts ?? 0) > 0 ? 'retryable' : 'pending'
}

/** Xác minh cục bộ (không gọi Fabric): chỉ commit Fabric thật có txHash mới là `verified`. */
export function localVerificationState(row: {
  status: string
  networkMode?: string | null
  txHash?: string | null
}): AuditVerificationState {
  if (row.status !== 'confirmed') return 'not-recorded'
  if (row.networkMode === 'simulation') return 'unavailable'
  return row.networkMode === 'fabric' && row.txHash ? 'verified' : 'unavailable'
}

/**
 * Link Explorer chỉ từ template cấu hình (`{txId}`) + txId thật của Fabric; không bao giờ từ host
 * của request. Template phải là http(s); txId được encode.
 */
export function buildExplorerAction(input: {
  template: string | undefined
  explorerState: 'disabled' | 'ready' | 'degraded' | undefined
  explorerEnabled: boolean
  networkMode: string | null | undefined
  status: string
  txId: string | null | undefined
}): AuditExplorerAction {
  if (
    input.status !== 'confirmed' ||
    input.networkMode !== 'fabric' ||
    !input.txId
  ) {
    return { available: false, url: null, reason: 'NOT_COMMITTED_ON_FABRIC' }
  }
  const template = input.template
  if (
    !template ||
    !template.includes('{txId}') ||
    !/^https?:\/\//i.test(template)
  ) {
    return { available: false, url: null, reason: 'EXPLORER_NOT_CONFIGURED' }
  }
  if (input.explorerEnabled && input.explorerState === 'degraded') {
    return { available: false, url: null, reason: 'EXPLORER_DEGRADED' }
  }
  return {
    available: true,
    url: template.replace('{txId}', encodeURIComponent(input.txId)),
    reason: null,
  }
}

/** Họ bằng chứng có khoá trực tiếp trên ledger để xác minh theo yêu cầu. */
export const AUDIT_VERIFICATION_READS: Record<
  string,
  { action: string; hashField: string; argIndex: number }
> = {
  'governance.published': {
    action: 'readGovernanceSnapshot',
    hashField: 'manifestHash',
    argIndex: 2,
  },
  'move-in.settled': {
    action: 'readMoveInSettlement',
    hashField: 'manifestHash',
    argIndex: 2,
  },
  'handover.completed': {
    action: 'readHandover',
    hashField: 'handoverHash',
    argIndex: 2,
  },
  'contract.activated': {
    action: 'readContract',
    hashField: 'contractHash',
    argIndex: 4,
  },
}
