import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsString, MinLength } from 'class-validator'

export const RENTAL_RECOVERY_ACTIONS = [
  'RETRY_ACTIVATION',
  'REISSUE_DEPOSIT_REQUEST',
  'EXPIRE_DEPOSIT',
  'RETRY_PROVISIONING',
  'RETRY_LEDGER',
] as const

export type RentalRecoveryAction = (typeof RENTAL_RECOVERY_ACTIONS)[number]

export class RecoverRentalTransactionDto {
  @ApiProperty({ enum: RENTAL_RECOVERY_ACTIONS })
  @IsEnum(RENTAL_RECOVERY_ACTIONS)
  action!: RentalRecoveryAction

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  reason!: string
}
