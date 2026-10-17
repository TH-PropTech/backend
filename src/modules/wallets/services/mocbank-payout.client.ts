import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../../../config/configuration'
import {
  asRecord,
  logField,
  postToGateway,
  type GatewayFetcher,
} from '../../mock-bank/providers/gateway.util'
import {
  isSuccessStatus,
  mocbankMerchantHeaders,
} from '../../mock-bank/providers/mocbank.adapter'

export type MocbankPayoutInput = {
  /** Stable per payout so a retry after a lost reply never pays twice. */
  orderId: string
  amount: number
  payeeAccountNumber: string
  description: string
}

/** Raised when Ví Mộc did not confirm the transfer; `code` is safe to store and log. */
export class MocbankPayoutError extends Error {
  constructor(readonly code: string) {
    super(`MOCBANK_PAYOUT_${code}`)
    this.name = 'MocbankPayoutError'
  }
}

/**
 * Simulated disbursement: after a MoMo/VNPay/ZaloPay payment the platform moves
 * the landlord's share from its own Ví Mộc wallet to the landlord's wallet
 * (`POST /api/payouts`). Sandbox only; real money needs a licensed disbursement
 * provider.
 */
@Injectable()
export class MocbankPayoutClient {
  private readonly logger = new Logger(MocbankPayoutClient.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  /** True when the Ví Mộc merchant credentials needed to pay out are set. */
  isConfigured(): boolean {
    const config = this.config()
    return Boolean(
      config?.baseUrl && config.merchantId && config.merchantSecret
    )
  }

  async payout(
    input: MocbankPayoutInput
  ): Promise<{ transactionCode: string }> {
    const config = this.config()
    if (!config || !this.isConfigured()) {
      throw new MocbankPayoutError('NOT_CONFIGURED')
    }
    const reply = await postToGateway(
      this.fetcher,
      `${config.baseUrl}/api/payouts`,
      {
        headers: {
          'content-type': 'application/json',
          ...mocbankMerchantHeaders(config),
        },
        body: JSON.stringify(input),
      },
      this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      )
    )
    const result = asRecord(reply.body)
    const data = asRecord(result?.data)
    const transactionCode = data?.transactionCode
    if (
      !isSuccessStatus(reply.status) ||
      result?.success !== true ||
      !data ||
      data.status !== 'SUCCESS' ||
      data.orderId !== input.orderId ||
      data.amount !== input.amount ||
      data.payeeAccountNumber !== input.payeeAccountNumber ||
      typeof transactionCode !== 'string'
    ) {
      const code = asRecord(result?.error)?.code
      this.logger.warn(
        `Ví Mộc payout rejected orderId=${input.orderId} http=${logField(reply.status)} code=${logField(code)}`
      )
      // The code comes from a remote system: keep only a plain upper-case token.
      throw new MocbankPayoutError(
        typeof code === 'string' && /^[A-Z_]{1,60}$/.test(code)
          ? code
          : 'GATEWAY_UNAVAILABLE'
      )
    }
    return { transactionCode }
  }

  private config(): PaymentsConfig['mocbank'] | undefined {
    return this.configService.get<PaymentsConfig['mocbank']>(
      'rentalFlow.payments.mocbank'
    )
  }
}
