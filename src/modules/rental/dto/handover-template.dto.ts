import { ApiProperty } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { HANDOVER_TEMPLATE_MAX_ITEMS } from '../utils/handover-template.util'

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class HandoverTemplateInventoryDefaultDto {
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
}

export class HandoverTemplateChecklistItemDto {
  @ApiProperty({ example: 'keys-handed' })
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{0,59}$/)
  id!: string

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string
}

export class SaveHandoverTemplateDraftDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number

  @ApiProperty({ type: [HandoverTemplateInventoryDefaultDto] })
  @IsArray()
  @ArrayMaxSize(HANDOVER_TEMPLATE_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => HandoverTemplateInventoryDefaultDto)
  inventoryDefaults!: HandoverTemplateInventoryDefaultDto[]

  @ApiProperty({ type: [HandoverTemplateChecklistItemDto] })
  @IsArray()
  @ArrayMaxSize(HANDOVER_TEMPLATE_MAX_ITEMS)
  @ArrayUnique((item: HandoverTemplateChecklistItemDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => HandoverTemplateChecklistItemDto)
  checklist!: HandoverTemplateChecklistItemDto[]
}

export class PublishHandoverTemplateDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedRevision!: number

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string
}
