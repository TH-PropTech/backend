import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'
import type { AlertFrequency } from '../schemas/saved-search.schema'

export class SavedSearchFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  district?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ward?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minArea?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxArea?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bedrooms?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bathrooms?: number

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[]

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  furniture?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  moveInTime?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  petFriendly?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string
}

export class CreateSavedSearchDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string

  @ApiProperty({ type: SavedSearchFiltersDto })
  @ValidateNested()
  @Type(() => SavedSearchFiltersDto)
  filters!: SavedSearchFiltersDto

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  alertEnabled?: boolean

  @ApiPropertyOptional({
    enum: ['instant', 'daily', 'weekly'],
    default: 'daily',
  })
  @IsOptional()
  @IsEnum(['instant', 'daily', 'weekly'])
  alertFrequency?: AlertFrequency
}

export class UpdateSavedSearchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @ApiPropertyOptional({ type: SavedSearchFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SavedSearchFiltersDto)
  filters?: SavedSearchFiltersDto

  @ApiPropertyOptional({ enum: ['instant', 'daily', 'weekly'] })
  @IsOptional()
  @IsEnum(['instant', 'daily', 'weekly'])
  alertFrequency?: AlertFrequency
}

export class ToggleAlertDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean
}
