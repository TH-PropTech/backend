import { ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import {
  WALLET_BRANDS,
  type WalletBrand,
} from '../../wallets/utils/supported-banks'
import {
  SELECTABLE_PAYMENT_PROVIDERS,
  type SelectablePaymentProvider,
} from '../../../config/configuration'
import type { PaymentClientChannel } from '../../payments/schemas/payment-attempt.schema'
import {
  MOMO_PAYMENT_METHODS,
  type MomoPaymentMethod,
  ZALOPAY_PAYMENT_METHODS,
  type ZalopayPaymentMethod,
} from '../providers/payment-provider.port'

/** Gateway choice shared by every init endpoint; server enforces the allow-list. */
export class PaymentInitChoiceDto {
  @ApiPropertyOptional({
    enum: SELECTABLE_PAYMENT_PROVIDERS,
    description: 'Gateway to pay with; defaults to the first enabled provider',
  })
  @IsOptional()
  @IsIn(SELECTABLE_PAYMENT_PROVIDERS)
  provider?: SelectablePaymentProvider

  @ApiPropertyOptional({
    enum: WALLET_BRANDS,
    description:
      'Ví Mộc only: wallet brand of the landlord account to pay into; defaults to mocbank',
  })
  @IsOptional()
  @IsIn(WALLET_BRANDS)
  brand?: WalletBrand

  @ApiPropertyOptional({ enum: ['web', 'mobile'], default: 'web' })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  clientChannel?: PaymentClientChannel

  @ApiPropertyOptional({
    enum: MOMO_PAYMENT_METHODS,
    default: 'wallet',
    description: 'MoMo only: wallet/QR, domestic ATM card or Visa/Master/JCB',
  })
  @IsOptional()
  @IsIn(MOMO_PAYMENT_METHODS)
  momoMethod?: MomoPaymentMethod

  @ApiPropertyOptional({
    enum: ZALOPAY_PAYMENT_METHODS,
    default: 'all',
    description: 'ZaloPay only: all methods on the gateway page, or card entry',
  })
  @IsOptional()
  @IsIn(ZALOPAY_PAYMENT_METHODS)
  zalopayMethod?: ZalopayPaymentMethod
}

export class InitDepositPaymentDto extends PaymentInitChoiceDto {
  @IsMongoId()
  depositAgreementId!: string
}

export class InitRentPaymentDto extends PaymentInitChoiceDto {
  @IsMongoId()
  paymentId!: string
}

export class InitSettlementPaymentDto extends PaymentInitChoiceDto {
  @IsMongoId()
  settlementId!: string
}

export class InitInvoicePaymentDto extends PaymentInitChoiceDto {
  @IsMongoId()
  paymentId!: string
}

export class PaymentCallbackDto {
  @IsString()
  txRef!: string

  @IsInt()
  @Min(1)
  amount!: number

  @IsString()
  @IsIn(['success', 'failed'])
  status!: 'success' | 'failed'
}
