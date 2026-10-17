import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  ArrayMaxSize,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator'
import { LAYOUT_LIMITS } from '../utils/apartment-layout'
import {
  APARTMENT_FURNITURE_KINDS,
  APARTMENT_DESIGN_FURNISHING,
  APARTMENT_DESIGN_THEMES,
  APARTMENT_LAYOUT_COORD_MAX,
  APARTMENT_LAYOUT_COORD_MIN,
  MAX_APARTMENT_LAYOUT_EXTRAS,
  MAX_APARTMENT_LAYOUT_ITEMS,
  type ApartmentDesignFurnishing,
  type ApartmentDesignLayoutItem,
  type ApartmentDesignTheme,
} from '../schemas/apartment.schema'

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
const LAYOUT_ID = /^[A-Za-z0-9_-]{1,48}$/

function isFiniteInRange(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= APARTMENT_LAYOUT_COORD_MIN &&
    value <= APARTMENT_LAYOUT_COORD_MAX
  )
}

function isLayoutItem(value: unknown): value is ApartmentDesignLayoutItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['x', 'z', 'rot', 'hidden'].includes(key)))
    return false
  if ('x' in item && !isFiniteInRange(item.x)) return false
  if ('z' in item && !isFiniteInRange(item.z)) return false
  if (
    'rot' in item &&
    (typeof item.rot !== 'number' || !Number.isFinite(item.rot))
  )
    return false
  return !('hidden' in item) || typeof item.hidden === 'boolean'
}

@ValidatorConstraint({ name: 'apartmentLayoutItems', async: false })
class ApartmentLayoutItemsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    const entries = Object.entries(value)
    return (
      entries.length <= MAX_APARTMENT_LAYOUT_ITEMS &&
      entries.every(([id, item]) => LAYOUT_ID.test(id) && isLayoutItem(item))
    )
  }

  defaultMessage(): string {
    return 'Bố cục nội thất mẫu không hợp lệ'
  }
}

@ValidatorConstraint({ name: 'uniqueApartmentLayoutExtraIds', async: false })
class UniqueApartmentLayoutExtraIdsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return false
    const ids = value.map(item =>
      item && typeof item === 'object'
        ? (item as Record<string, unknown>).id
        : undefined
    )
    return (
      ids.every(id => typeof id === 'string') &&
      new Set(ids).size === ids.length
    )
  }

  defaultMessage(): string {
    return 'Mã đồ nội thất thêm vào không được trùng nhau'
  }
}

export class ApartmentDesignLayoutExtraDto {
  @ApiProperty({ pattern: LAYOUT_ID.source, maxLength: 48 })
  @Matches(LAYOUT_ID)
  id!: string

  @ApiProperty({ enum: APARTMENT_FURNITURE_KINDS })
  @IsIn(APARTMENT_FURNITURE_KINDS)
  kind!: (typeof APARTMENT_FURNITURE_KINDS)[number]

  @ApiProperty({
    minimum: APARTMENT_LAYOUT_COORD_MIN,
    maximum: APARTMENT_LAYOUT_COORD_MAX,
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(APARTMENT_LAYOUT_COORD_MIN)
  @Max(APARTMENT_LAYOUT_COORD_MAX)
  x!: number

  @ApiProperty({
    minimum: APARTMENT_LAYOUT_COORD_MIN,
    maximum: APARTMENT_LAYOUT_COORD_MAX,
  })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(APARTMENT_LAYOUT_COORD_MIN)
  @Max(APARTMENT_LAYOUT_COORD_MAX)
  z!: number

  @ApiProperty({ description: 'Góc xoay theo radian' })
  @IsNumber({ allowInfinity: false, allowNaN: false })
  rot!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hidden?: boolean

  @ApiPropertyOptional({ description: 'Tầng của mặt bằng tuỳ chỉnh' })
  @IsOptional()
  @Matches(LAYOUT_ID)
  floor?: string

  @ApiPropertyOptional({
    type: [Number],
    description: 'Kích thước tuỳ chỉnh của builder (tối đa 3 số)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsNumber({ allowInfinity: false, allowNaN: false }, { each: true })
  args?: number[]
}

@ValidatorConstraint({ name: 'apartmentLayoutCustomPlan', async: false })
class ApartmentLayoutCustomPlanConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    const floors = (value as Record<string, unknown>).floors
    return Array.isArray(floors) && floors.length <= LAYOUT_LIMITS.floors
  }

  defaultMessage(): string {
    return 'Mặt bằng tuỳ chỉnh tối đa 5 tầng'
  }
}

export class ApartmentDesignLayoutDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'object' },
    maxProperties: MAX_APARTMENT_LAYOUT_ITEMS,
  })
  @IsOptional()
  @IsObject()
  @Validate(ApartmentLayoutItemsConstraint)
  items?: Record<string, ApartmentDesignLayoutItem>

  @ApiPropertyOptional({
    type: [ApartmentDesignLayoutExtraDto],
    maxItems: MAX_APARTMENT_LAYOUT_EXTRAS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_APARTMENT_LAYOUT_EXTRAS)
  @Validate(UniqueApartmentLayoutExtraIdsConstraint)
  @ValidateNested({ each: true })
  @Type(() => ApartmentDesignLayoutExtraDto)
  extras?: ApartmentDesignLayoutExtraDto[]

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'object' },
    description: 'Đổi tên / loại sàn phòng của mẫu, khoá theo mã phòng',
  })
  @IsOptional()
  @IsObject()
  rooms?: Record<string, unknown>

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Sửa cửa của mẫu: { removed, moved, added }',
  })
  @IsOptional()
  @IsObject()
  openings?: Record<string, unknown>

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Mặt bằng tuỳ chỉnh nhiều tầng (mét), thay hẳn mẫu: { floors }',
  })
  @IsOptional()
  @IsObject()
  @Validate(ApartmentLayoutCustomPlanConstraint)
  custom?: Record<string, unknown>
}

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

  @ApiPropertyOptional({ type: ApartmentDesignLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApartmentDesignLayoutDto)
  layout?: ApartmentDesignLayoutDto

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

  @ApiPropertyOptional({ type: ApartmentDesignLayoutDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApartmentDesignLayoutDto)
  layout?: ApartmentDesignLayoutDto

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
