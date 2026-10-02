import { IsIn, IsInt, IsMongoId, IsString, Min } from 'class-validator'

export class InitDepositPaymentDto {
  @IsMongoId()
  depositAgreementId!: string
}

export class InitRentPaymentDto {
  @IsMongoId()
  paymentId!: string
}

export class InitSettlementPaymentDto {
  @IsMongoId()
  settlementId!: string
}

export class InitInvoicePaymentDto {
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
