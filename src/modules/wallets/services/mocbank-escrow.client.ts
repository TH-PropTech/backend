import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../../../config/configuration'
import type { DepositEscrowStatus } from '../../contracts/schemas/deposit-agreement.schema'
import {
  asRecord,
  getFromGateway,
  logField,
  postToGateway,
  type GatewayFetcher,
  type GatewayReply,
} from '../../mock-bank/providers/gateway.util'
import {
  isSuccessStatus,
  mocbankMerchantHeaders,
} from '../../mock-bank/providers/mocbank.adapter'

const ESCROW_STATUSES: readonly DepositEscrowStatus[] = [
  'AWAITING_PAYMENT',
  'HELD',
  'SETTLED',
  'AUTO_REFUNDED',
  'CANCELLED',
  'EXPIRED',
]

/** Escrow as Ví Mộc reports it; only validated fields are exposed. */
export type MocbankEscrow = {
  escrowId: string
  status: DepositEscrowStatus
  amount: number
  autoRefundAt: Date
  transactionCodes: string[]
  /** True once `autoRefundAt` passed and Ví Mộc is about to refund on its own. */
  autoRefundDue: boolean
}

export type MocbankEscrowAllocation = {
  party: 'PAYEE' | 'PAYER'
  amount: number
}

export type MocbankEscrowSettleInput = {
  /** Deterministic per agreement and kind so a retry never creates a second order. */
  settlementId: string
  reason: string
  allocations: MocbankEscrowAllocation[]
}

/** Raised when Ví Mộc did not confirm the call; `code` is safe to store and log. */
export class MocbankEscrowError extends Error {
  constructor(readonly code: string) {
    super(`MOCBANK_ESCROW_${code}`)
    this.name = 'MocbankEscrowError'
  }
}

/** `409 ESCROW_ALREADY_SETTLED`: the caller must `get` the escrow and apply the real result. */
export class MocbankEscrowAlreadySettledError extends MocbankEscrowError {
  constructor() {
    super('ESCROW_ALREADY_SETTLED')
    this.name = 'MocbankEscrowAlreadySettledError'
  }
}

/** Client for the Ví Mộc escrow API (`/api/escrows/:id`). */
@Injectable()
export class MocbankEscrowClient {
  private readonly logger = new Logger(MocbankEscrowClient.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  async get(escrowId: string): Promise<MocbankEscrow> {
    const { config, timeoutMs } = this.settings()
    const reply = await getFromGateway(
      this.fetcher,
      this.url(config, escrowId),
      mocbankMerchantHeaders(config),
      timeoutMs
    )
    return this.parse(reply, escrowId, 'get')
  }

  async settle(
    escrowId: string,
    input: MocbankEscrowSettleInput
  ): Promise<MocbankEscrow> {
    return this.post(escrowId, 'settle', input)
  }

  async extend(escrowId: string, autoRefundAt: Date): Promise<MocbankEscrow> {
    return this.post(escrowId, 'extend', {
      autoRefundAt: autoRefundAt.toISOString(),
    })
  }

  private async post(
    escrowId: string,
    action: 'settle' | 'extend',
    body: object
  ): Promise<MocbankEscrow> {
    const { config, timeoutMs } = this.settings()
    const reply = await postToGateway(
      this.fetcher,
      `${this.url(config, escrowId)}/${action}`,
      {
        headers: {
          'content-type': 'application/json',
          ...mocbankMerchantHeaders(config),
        },
        body: JSON.stringify(body),
      },
      timeoutMs
    )
    return this.parse(reply, escrowId, action)
  }

  private parse(
    reply: GatewayReply,
    escrowId: string,
    action: string
  ): MocbankEscrow {
    const result = asRecord(reply.body)
    const errorCode = asRecord(result?.error)?.code
    if (reply.status === 409 && errorCode === 'ESCROW_ALREADY_SETTLED') {
      throw new MocbankEscrowAlreadySettledError()
    }
    const escrow = isSuccessStatus(reply.status)
      ? toEscrow(result?.success === true ? asRecord(result.data) : null)
      : null
    if (!escrow || escrow.escrowId !== escrowId) {
      this.logger.warn(
        `Ví Mộc escrow ${action} rejected escrowId=${escrowId} http=${logField(reply.status)} code=${logField(errorCode)}`
      )
      // The code comes from a remote system: keep only a plain upper-case token.
      throw new MocbankEscrowError(
        typeof errorCode === 'string' && /^[A-Z_]{1,60}$/.test(errorCode)
          ? errorCode
          : 'GATEWAY_UNAVAILABLE'
      )
    }
    return escrow
  }

  private url(config: PaymentsConfig['mocbank'], escrowId: string): string {
    return `${config.baseUrl}/api/escrows/${encodeURIComponent(escrowId)}`
  }

  private settings(): {
    config: PaymentsConfig['mocbank']
    timeoutMs: number
  } {
    const config = this.configService.get<PaymentsConfig['mocbank']>(
      'rentalFlow.payments.mocbank'
    )
    if (!config?.baseUrl || !config.merchantId || !config.merchantSecret) {
      throw new MocbankEscrowError('NOT_CONFIGURED')
    }
    return {
      config,
      timeoutMs: this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      ),
    }
  }
}

function toEscrow(data: Record<string, unknown> | null): MocbankEscrow | null {
  if (!data) return null
  const { escrowId, status, amount, autoRefundAt, transactionCodes } = data
  const refundAt =
    typeof autoRefundAt === 'string' ? new Date(autoRefundAt) : null
  if (
    typeof escrowId !== 'string' ||
    !ESCROW_STATUSES.includes(status as DepositEscrowStatus) ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    !refundAt ||
    Number.isNaN(refundAt.getTime())
  ) {
    return null
  }
  if (
    transactionCodes !== undefined &&
    (!Array.isArray(transactionCodes) ||
      !transactionCodes.every(code => typeof code === 'string'))
  ) {
    return null
  }
  return {
    escrowId,
    status: status as DepositEscrowStatus,
    amount,
    autoRefundAt: refundAt,
    transactionCodes: transactionCodes ?? [],
    autoRefundDue: data.autoRefundDue === true,
  }
}
