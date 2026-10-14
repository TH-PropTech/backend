import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator'

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value

export const OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH = 128

export function isValidOwnershipTransferIdempotencyKey(
  value: unknown
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= OWNERSHIP_TRANSFER_IDEMPOTENCY_KEY_MAX_LENGTH
  )
}

export class PreviewOwnershipTransferDto {
  @ApiProperty({ example: 'target@example.com', maxLength: 254 })
  @Transform(normalizeEmail)
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  targetEmail!: string
}

export class ApplyOwnershipTransferDto {
  @ApiProperty({
    example:
      'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^sha256:[a-f0-9]{64}$/)
  @MaxLength(71)
  previewHash!: string
}

export interface OwnershipTransferTargetResponse {
  id: string
  email: string
  role: 'landlord'
}
