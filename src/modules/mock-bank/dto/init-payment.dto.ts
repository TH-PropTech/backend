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
  SELECTABLE_PAYMENT_PROVIDERS,
  type SelectablePaymentProvider,
} from '../../../config/configuration'
import type { PaymentClientChannel } from '../../payments/schemas/payment-attempt.schema'

/** Gateway choice shared by every init endpoint; server enforces the allow-list. */
export class PaymentInitChoiceDto {
  @ApiPropertyOptional({
    enum: SELECTABLE_PAYMENT_PROVIDERS,
    description: 'Gateway to pay with; defaults to the first enabled provider',
  })
  @IsOptional()
  @IsIn(SELECTABLE_PAYMENT_PROVIDERS)
  provider?: SelectablePaymentProvider

  @ApiPropertyOptional({ enum: ['web', 'mobile'], default: 'web' })
  @IsOptional()
  @IsIn(['web', 'mobile'])
  clientChannel?: PaymentClientChannel
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
