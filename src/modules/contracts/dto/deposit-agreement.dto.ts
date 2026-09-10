import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator'

export class ConsentDepositAgreementDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number

  @IsString()
  @IsNotEmpty()
  expectedContentHash!: string
}

export class ConfirmDepositPaymentDto {
  @IsString()
  @IsNotEmpty()
  note!: string
}
