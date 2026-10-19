import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator'
import {
  MOCBANK_ACCOUNT_PATTERN,
  WALLET_BRANDS,
  type WalletBrand,
} from '../utils/supported-banks'

/**
 * Liên kết ví = liên kết một ví Ví Mộc có thật, xác minh qua tra cứu tên chủ
 * ví (không cho gõ tay ngân hàng/tên chủ tài khoản như trước).
 */
export class LinkWalletDto {
  @ApiProperty({ example: '812345678901', description: '12 chữ số (Ví Mộc)' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value
  )
  @Matches(MOCBANK_ACCOUNT_PATTERN, { message: 'ACCOUNT_NUMBER_INVALID' })
  accountNumber!: string

  @ApiPropertyOptional({
    enum: WALLET_BRANDS,
    description: 'Thương hiệu ví; mặc định mocbank (ví chính)',
  })
  @IsOptional()
  @IsIn(WALLET_BRANDS)
  brand?: WalletBrand
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

export class ReceivingStatusQueryDto {
  @ApiPropertyOptional({
    description: 'true để bỏ qua cache và kiểm tra lại ví ngay',
    example: 'true',
  })
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) =>
      value === true || value === 'true' || value === '1'
  )
  @IsBoolean()
  refresh?: boolean
}
