import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
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
import { HANDOVER_INVENTORY_MAX_ITEMS } from './move-in-handover.dto'

export const MOVE_OUT_ITEM_CONDITIONS = ['good', 'damaged', 'missing'] as const
const SHA256_HEX = /^[a-f0-9]{64}$/

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class MoveOutInventoryItemDto {
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

  @ApiProperty({ enum: MOVE_OUT_ITEM_CONDITIONS })
  @IsIn(MOVE_OUT_ITEM_CONDITIONS)
  condition!: (typeof MOVE_OUT_ITEM_CONDITIONS)[number]

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}

export class RecordMoveOutHandoverDto {
  @ApiProperty({ example: '2030-02-01T09:00:00.000Z' })
  @IsISO8601({ strict: true })
  handedBackAt!: string

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

  @ApiPropertyOptional({
    type: [MoveOutInventoryItemDto],
    maxItems: HANDOVER_INVENTORY_MAX_ITEMS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HANDOVER_INVENTORY_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => MoveOutInventoryItemDto)
  inventoryItems?: MoveOutInventoryItemDto[]

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class ConfirmMoveOutHandoverDto {
  @ApiProperty({ pattern: SHA256_HEX.source })
  @IsString()
  @Matches(SHA256_HEX)
  handoverHash!: string
}

export class MoveOutDiscrepancyDto extends ConfirmMoveOutHandoverDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string
}

/** Dùng chung cho yêu cầu tranh chấp biên bản trả nhà và bảng khấu trừ. */
export class DisputeNoteDto {
  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string
}
