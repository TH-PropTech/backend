import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'

export class CreateRiskLayerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  district!: string

  @ApiProperty({ description: 'Source-defined risk layer identifier' })
  @IsString()
  @IsNotEmpty()
  layerType!: string

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  severity!: number

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  source!: string

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  timestamp!: Date

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number

  @ApiPropertyOptional({
    description: 'Optional GeoJSON object from the source',
  })
  @IsOptional()
  @IsObject()
  geoJson?: Record<string, unknown>
}

export class UpdateRiskLayerDto extends PartialType(CreateRiskLayerDto) {}
