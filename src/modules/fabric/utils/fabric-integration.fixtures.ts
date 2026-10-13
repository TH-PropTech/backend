import { createHash } from 'node:crypto'

/**
 * Sổ cái Fabric giả lập có ngữ nghĩa chaincode PROP-399 (chỉ dùng cho integration test): khoá trực
 * tiếp, replay đồng nhất là idempotent, payload khác là ERR_CONFLICT, tham chiếu governance/deposit
 * được kiểm tra, schema v3 chỉ được nhận khi chaincode quảng bá. Mỗi giao dịch thật nhận txId và
 * số khối tăng dần — đúng như commit status thật; không có `sim_`.
 */
type Row = Record<string, unknown>

const PII_MARKERS = [
  'tenantName',
  'tenantCccd',
  'landlordName',
  'landlordCccd',
  'meterReadings',
  'keyCount',
  'inventoryReference',
  'overrideReason',
  'discrepancyNote',
]

export class FakeFabricLedger {
  readonly world = new Map<string, Row>()
  /** Chỉ các ghi trạng thái MỚI (không tính replay idempotent). */
  readonly writes: Array<{ action: string; key: string; txId: string }> = []
  /** Mọi lần gửi tới Fabric (kể cả replay/bị từ chối), theo thứ tự. */
  readonly submitted: Array<{ action: string; args: string[] }> = []
  replays = 0
  mode: 'fabric' | 'simulation' = 'fabric'
  abiVersion: 1 | 2 = 2
  evidenceSchemaVersions: number[] = [2, 3]
  unavailable = false
  private readonly failures = new Map<string, Error[]>()
  private counter = 0

  failNext(action: string, error: Error): void {
    this.failures.set(action, [...(this.failures.get(action) ?? []), error])
  }

  getChaincodeAbiVersion(): 1 | 2 {
    return this.abiVersion
  }

  supportsEvidenceSchemaVersion(version: number): boolean {
    return this.evidenceSchemaVersions.includes(version)
  }

  getStatus(): Row {
    return {
      mode: this.mode,
      connectionState: this.unavailable ? 'unavailable' : 'connected',
      ready: !this.unavailable,
      explorer: { enabled: false, state: 'disabled', publicUrl: null },
    }
  }

  async submitTransaction(
    action: string,
    args: string[],
    metadata: unknown = {}
  ): Promise<{
    txHash: string
    blockNumber: number | null
    success: boolean
    networkMode: 'fabric'
  }> {
    void metadata
    this.submitted.push({ action, args })
    await Promise.resolve()
    if (this.unavailable) {
      throw new Error(
        'FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is unavailable'
      )
    }
    const queued = this.failures.get(action)
    if (queued?.length) throw queued.shift() as Error

    this.counter += 1
    const txId = `fabric-tx-${this.counter}`
    const blockNumber = 100 + this.counter
    const { key, record } = this.apply(action, args, txId)
    const existing = this.world.get(key)
    if (existing) {
      if (!this.samePayload(existing, record)) {
        throw new Error(
          `Fabric transaction failed: ERR_CONFLICT: ${key} payload conflict`
        )
      }
      this.replays += 1 // replay đồng nhất: giao dịch commit nhưng không đổi world state
    } else {
      this.world.set(key, record)
      this.writes.push({ action, key, txId })
    }
    return { txHash: txId, blockNumber, success: true, networkMode: 'fabric' }
  }

  async evaluateTransaction(action: string, args: string[]): Promise<unknown> {
    await Promise.resolve()
    if (this.unavailable) {
      throw new Error(
        'FABRIC_GATEWAY_UNAVAILABLE: Gateway connection is unavailable'
      )
    }
    const prefixByRead: Record<string, string> = {
      readGovernanceSnapshot: 'GOVERNANCE_',
      readContract: 'CONTRACT_',
      readMoveInSettlement: 'MOVEIN_',
      readHandover: 'HANDOVER_',
    }
    if (action === 'listEvidenceKeys') {
      const prefix = args[0] ?? ''
      const keys = [...this.world.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, record]) => ({
          key,
          hash: (record.manifestHash ??
            record.handoverHash ??
            record.contractHash ??
            null) as string | null,
        }))
      return { keys, bookmark: '', hasMore: false }
    }
    const prefix = prefixByRead[action]
    if (!prefix)
      throw new Error(`Fabric query failed: unsupported read ${action}`)
    const record = this.world.get(`${prefix}${args[0]}`)
    if (!record) {
      throw new Error(
        'Fabric query failed: ERR_NOT_FOUND: evidence does not exist'
      )
    }
    return record
  }

  /** Mô phỏng mutate ledger bởi bên ngoài (chỉ để dựng tình huống lệch trong test). */
  tamper(key: string, patch: Row): void {
    const record = this.world.get(key)
    if (record) Object.assign(record, patch)
  }

  deleteKey(key: string): void {
    this.world.delete(key)
  }

  // ── Ngữ nghĩa chaincode ────────────────────────────────────────────────────

  private apply(
    action: string,
    args: string[],
    txId: string
  ): { key: string; record: Row } {
    switch (action) {
      case 'recordDeposit':
        return {
          key: `DEPOSIT_${args[0]}`,
          record: { depositId: args[0], depositHash: args[4], txId },
        }
      case 'publishGovernanceSnapshot':
        return {
          key: `GOVERNANCE_${args[0]}`,
          record: {
            snapshotId: args[0],
            version: Number(args[1]),
            manifestHash: args[2],
            manifestSchemaVersion: Number(args[3]),
            txId,
          },
        }
      case 'createContract':
        return this.createContract(args, txId)
      case 'recordPayment': {
        this.requireContract(args[1])
        return {
          key: `PAYMENT_${args[0]}`,
          record: {
            paymentId: args[0],
            contractId: args[1],
            amount: args[2],
            paymentHash: args[3],
            txId,
          },
        }
      }
      case 'recordMoveInSettlement':
        this.requireContract(args[1])
        return {
          key: `MOVEIN_${args[0]}`,
          record: {
            settlementId: args[0],
            contractId: args[1],
            manifestHash: args[2],
            manifestSchemaVersion: Number(args[3]),
            occurredAt: args[4],
            txId,
          },
        }
      case 'recordHandover':
        this.requireContract(args[1])
        return {
          key: `HANDOVER_${args[0]}`,
          record: {
            settlementId: args[0],
            contractId: args[1],
            handoverHash: args[2],
            manifestSchemaVersion: Number(args[3]),
            revision: Number(args[4]),
            overrideUsed: args[5] === 'true',
            occurredAt: args[6],
            txId,
          },
        }
      default:
        throw new Error(
          `Fabric transaction failed: ERR_SCHEMA: unsupported action ${action}`
        )
    }
  }

  private requireContract(contractId: string | undefined): void {
    if (!this.world.has(`CONTRACT_${contractId}`)) {
      throw new Error(
        `Fabric transaction failed: ERR_NOT_FOUND: contract ${contractId} not on ledger`
      )
    }
  }

  private createContract(
    args: string[],
    txId: string
  ): { key: string; record: Row } {
    const [
      contractId,
      contractCode,
      tenantId,
      landlordId,
      contractHash,
      monthlyRent,
      startDate,
      depositId,
      depositHash,
      evidenceJson,
    ] = args
    if (depositId) {
      const deposit = this.world.get(`DEPOSIT_${depositId}`)
      if (!deposit || deposit.depositHash !== depositHash) {
        throw new Error(
          'Fabric transaction failed: ERR_DEPENDENCY: deposit evidence missing or different'
        )
      }
    }
    let governanceSnapshotId: string | null = null
    if (evidenceJson) {
      if (PII_MARKERS.some(marker => evidenceJson.includes(marker))) {
        throw new Error(
          'Fabric transaction failed: ERR_SCHEMA: evidence must not contain PII'
        )
      }
      const evidence = JSON.parse(evidenceJson) as Row
      if (evidence.schemaVersion === 3) {
        if (!this.evidenceSchemaVersions.includes(3)) {
          throw new Error(
            'Fabric transaction failed: ERR_SCHEMA: evidence schema version 3 unsupported'
          )
        }
        const governance = evidence.governance as Row
        const snapshot = this.world.get(
          `GOVERNANCE_${String(governance.snapshotId)}`
        )
        if (
          !snapshot ||
          snapshot.manifestHash !== governance.manifestHash ||
          snapshot.version !== governance.version
        ) {
          throw new Error(
            'Fabric transaction failed: ERR_GOVERNANCE_MISMATCH: snapshot missing or different'
          )
        }
        governanceSnapshotId = String(governance.snapshotId)
      }
    }
    return {
      key: `CONTRACT_${contractId}`,
      record: {
        contractId,
        contractCode,
        tenantId,
        landlordId,
        contractHash,
        monthlyRent,
        startDate,
        depositId: depositId || null,
        governanceSnapshotId,
        txId,
      },
    }
  }

  private samePayload(existing: Row, incoming: Row): boolean {
    const strip = (row: Row): string =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== 'txId')
        )
      )
    return strip(existing) === strip(incoming)
  }
}

export function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Làm mọi item pending/processing đến hạn ngay (bỏ qua backoff) để test chạy nhiều vòng worker. */
export function makeDue(rows: Row[]): void {
  for (const row of rows) {
    if (row.status === 'pending') row.nextRetryAt = new Date(0)
  }
}
