import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'

export class RespondRentalApplicationDto {
  @ApiProperty({ enum: ['accepted', 'rejected'] })
  @IsEnum(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected'

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reasonCode!: string

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  landlordFeeAck?: string
}
