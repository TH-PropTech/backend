import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { MeterPhotosDto } from './meter-photos.dto'

export const HANDOVER_ITEM_CONDITIONS = ['good', 'damaged'] as const
export const HANDOVER_INVENTORY_MAX_ITEMS = 100
const SHA256_HEX = /^[a-f0-9]{64}$/

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class HandoverInventoryItemDto {
  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number

  @ApiProperty({ enum: HANDOVER_ITEM_CONDITIONS })
  @IsIn(HANDOVER_ITEM_CONDITIONS)
  condition!: (typeof HANDOVER_ITEM_CONDITIONS)[number]

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class HandoverChecklistAnswerDto {
  @ApiProperty({ example: 'keys-handed' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  id!: string

  @ApiProperty()
  @IsBoolean()
  checked!: boolean
}

export class RecordHandoverDto {
  @ApiProperty({ example: '2030-02-01T09:00:00.000Z' })
  @IsISO8601({ strict: true })
  handedOverAt!: string

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  electricity!: number

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  water!: number

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  keyCount!: number

  @ApiPropertyOptional({ type: MeterPhotosDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MeterPhotosDto)
  meterPhotos?: MeterPhotosDto

  @ApiPropertyOptional({
    type: [HandoverInventoryItemDto],
    maxItems: HANDOVER_INVENTORY_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HANDOVER_INVENTORY_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HandoverInventoryItemDto)
  inventoryItems?: HandoverInventoryItemDto[]

  @ApiPropertyOptional({
    type: [HandoverChecklistAnswerDto],
    maxItems: HANDOVER_INVENTORY_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HANDOVER_INVENTORY_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HandoverChecklistAnswerDto)
  checklist?: HandoverChecklistAnswerDto[]

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  inventoryReference?: string

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string
}

export class ConfirmHandoverDto {
  @ApiProperty({ pattern: SHA256_HEX.source })
  @IsString()
  @Matches(SHA256_HEX)
  handoverHash!: string

  @ApiProperty({ enum: ['tenant', 'landlord'] })
  @IsIn(['tenant', 'landlord'])
  role!: 'tenant' | 'landlord'
}

export class HandoverDiscrepancyDto {
  @ApiProperty({ pattern: SHA256_HEX.source })
  @IsString()
  @Matches(SHA256_HEX)
  handoverHash!: string

  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string
}
