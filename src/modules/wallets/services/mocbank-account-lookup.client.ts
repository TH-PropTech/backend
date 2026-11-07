import { Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PaymentsConfig } from '../../../config/configuration'
import {
  asRecord,
  getFromGateway,
  logField,
  type GatewayFetcher,
} from '../../mock-bank/providers/gateway.util'
import { WALLET_BRANDS, type WalletBrand } from '../utils/supported-banks'
import {
  isSuccessStatus,
  mocbankMerchantHeaders,
} from '../../mock-bank/providers/mocbank.adapter'

/** Raised when Ví Mộc did not confirm the call; `code` is safe to store and log. */
export class MocbankAccountLookupError extends Error {
  constructor(readonly code: string) {
    super(`MOCBANK_ACCOUNT_LOOKUP_${code}`)
    this.name = 'MocbankAccountLookupError'
  }
}

/** Ví Mộc account lookups used when linking a payout wallet (no funds are held by the platform). */
@Injectable()
export class MocbankAccountLookupClient {
  private readonly logger = new Logger(MocbankAccountLookupClient.name)
  private readonly fetcher: GatewayFetcher

  constructor(
    private readonly configService: ConfigService,
    @Optional() fetcher?: GatewayFetcher
  ) {
    this.fetcher = fetcher ?? globalThis.fetch
  }

  /** Looks up the holder name of a Ví Mộc account before linking it as a payout wallet. */
  async resolveAccountHolder(accountNumber: string): Promise<string> {
    return (await this.resolveAccount(accountNumber)).accountName
  }

  /** Holder name + wallet brand; a service that omits/garbles `brand` is treated as MOCBANK. */
  async resolveAccount(
    accountNumber: string
  ): Promise<{ accountName: string; brand: WalletBrand }> {
    const { config, timeoutMs } = this.settings()
    const reply = await getFromGateway(
      this.fetcher,
      `${config.baseUrl}/api/wallets/resolve/${encodeURIComponent(accountNumber)}`,
      mocbankMerchantHeaders(config),
      timeoutMs
    )
    const result = asRecord(reply.body)
    const data = result?.success === true ? asRecord(result.data) : null
    const accountName =
      isSuccessStatus(reply.status) && data ? data.accountName : null
    if (typeof accountName !== 'string' || !accountName) {
      if (reply.status === 404) {
        throw new MocbankAccountLookupError('WALLET_NOT_FOUND')
      }
      this.logger.warn(
        `Ví Mộc account resolve failed http=${logField(reply.status)}`
      )
      throw new MocbankAccountLookupError('GATEWAY_UNAVAILABLE')
    }
    const rawBrand =
      typeof data?.brand === 'string' ? data.brand.toLowerCase() : ''
    const brand = WALLET_BRANDS.find(item => item === rawBrand) ?? 'mocbank'
    return { accountName, brand }
  }

  private settings(): {
    config: PaymentsConfig['mocbank']
    timeoutMs: number
  } {
    const config = this.configService.get<PaymentsConfig['mocbank']>(
      'rentalFlow.payments.mocbank'
    )
    if (!config?.baseUrl || !config.merchantId || !config.merchantSecret) {
      throw new MocbankAccountLookupError('NOT_CONFIGURED')
    }
    return {
      config,
      timeoutMs: this.configService.getOrThrow<number>(
        'rentalFlow.payments.gatewayTimeoutMs'
      ),
    }
  }
}
