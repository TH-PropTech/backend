import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'
import {
  APARTMENT_DESIGN_FURNISHING,
  APARTMENT_DESIGN_THEMES,
  type ApartmentDesignFurnishing,
  type ApartmentDesignTheme,
} from '../schemas/apartment.schema'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export class ApartmentDesignPaletteDto {
  @ApiPropertyOptional({ example: '#cfa67a' })
  @IsOptional()
  @Matches(HEX_COLOR)
  floor?: string

  @ApiPropertyOptional({ example: '#f4f1ea' })
  @IsOptional()
  @Matches(HEX_COLOR)
  wall?: string

  @ApiPropertyOptional({ example: '#b98b5e' })
  @IsOptional()
  @Matches(HEX_COLOR)
  wood?: string

  @ApiPropertyOptional({ example: '#5f7fa6' })
  @IsOptional()
  @Matches(HEX_COLOR)
  sofa?: string

  @ApiPropertyOptional({ example: '#e8a33d' })
  @IsOptional()
  @Matches(HEX_COLOR)
  accent?: string
}

export class CreateApartmentDesignDto {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @ApiProperty({ enum: APARTMENT_DESIGN_THEMES })
  @IsIn(APARTMENT_DESIGN_THEMES)
  theme!: ApartmentDesignTheme

  @ApiPropertyOptional({ type: ApartmentDesignPaletteDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApartmentDesignPaletteDto)
  palette?: ApartmentDesignPaletteDto

  @ApiPropertyOptional({
    enum: APARTMENT_DESIGN_FURNISHING,
    nullable: true,
    description: 'null/bỏ trống = theo mức nội thất của tin đăng',
  })
  @IsOptional()
  @IsIn(APARTMENT_DESIGN_FURNISHING)
  furnishing?: ApartmentDesignFurnishing | null

  @ApiPropertyOptional({ minimum: 6, maximum: 18, default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(6)
  @Max(18)
  defaultHour?: number

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  visible?: boolean

  @ApiPropertyOptional({ description: 'Thứ tự hiển thị, nhỏ hơn hiện trước' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number
}

export class UpdateApartmentDesignDto {
  @ApiPropertyOptional({ maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @ApiPropertyOptional({ enum: APARTMENT_DESIGN_THEMES })
  @IsOptional()
  @IsIn(APARTMENT_DESIGN_THEMES)
  theme?: ApartmentDesignTheme

  @ApiPropertyOptional({ type: ApartmentDesignPaletteDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApartmentDesignPaletteDto)
  palette?: ApartmentDesignPaletteDto

  @ApiPropertyOptional({ enum: APARTMENT_DESIGN_FURNISHING, nullable: true })
  @IsOptional()
  @IsIn(APARTMENT_DESIGN_FURNISHING)
  furnishing?: ApartmentDesignFurnishing | null

  @ApiPropertyOptional({ minimum: 6, maximum: 18 })
  @IsOptional()
  @IsNumber()
  @Min(6)
  @Max(18)
  defaultHour?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  visible?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  order?: number
}
