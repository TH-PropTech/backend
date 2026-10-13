import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { SUPPORTED_BANK_CODES } from '../utils/supported-banks'

export class LinkWalletDto {
  @ApiProperty({ enum: SUPPORTED_BANK_CODES })
  @IsIn(SUPPORTED_BANK_CODES)
  bankCode!: string

  @ApiProperty({ example: '0123456789', description: '6-19 chữ số' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value
  )
  @Matches(/^\d{6,19}$/, { message: 'ACCOUNT_NUMBER_INVALID' })
  accountNumber!: string

  @ApiProperty({ example: 'NGUYEN VAN A' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountHolder!: string
}

export class WalletTransactionsQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  limit?: number
}
