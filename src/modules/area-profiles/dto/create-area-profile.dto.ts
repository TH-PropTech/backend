import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import type { FacilityType } from '../schemas/nearby-facility.schema'

const FACILITY_TYPES = [
  'school',
  'hospital',
  'market',
  'bus_stop',
  'park',
  'gym',
  'bank',
  'police',
  'post_office',
  'supermarket',
] as const

export class NearbyFacilityDto {
  @ApiProperty({ enum: FACILITY_TYPES })
  @IsEnum(FACILITY_TYPES)
  type!: FacilityType
  @ApiProperty() @IsString() @IsNotEmpty() name!: string
  @ApiProperty({ minimum: 0 }) @IsNumber() @Min(0) distanceMeters!: number
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  travelTimeMinutes?: number
  @ApiPropertyOptional({ enum: ['walk', 'drive'] })
  @IsOptional()
  @IsEnum(['walk', 'drive'])
  travelMode?: 'walk' | 'drive'
}

export class CreateAreaProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() district!: string
  @ApiProperty() @IsString() @IsNotEmpty() city!: string
  @ApiPropertyOptional() @IsOptional() @IsString() ward?: string
  @ApiProperty() @IsString() @MinLength(20) overview!: string
  @ApiProperty({ type: [NearbyFacilityDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NearbyFacilityDto)
  facilities!: NearbyFacilityDto[]
  @ApiProperty() @IsString() @IsNotEmpty() source!: string
  @ApiPropertyOptional() @IsOptional() @IsString() disclaimer?: string
}

export class UpdateAreaProfileDto extends PartialType(CreateAreaProfileDto) {}
