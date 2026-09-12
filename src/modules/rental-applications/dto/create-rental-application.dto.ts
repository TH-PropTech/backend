import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayNotEmpty,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class CreateRentalApplicationDto {
  @ApiProperty() @IsString() @IsNotEmpty() apartmentId!: string
  @ApiProperty({ description: 'Approved rental package identifier' })
  @IsString()
  @IsNotEmpty()
  packageId!: string

  @ApiProperty({ description: 'Package version observed by tenant' })
  @IsInt()
  @Min(1)
  packageVersion!: number

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  occupants!: number
  @ApiProperty() @IsDateString() moveInDate!: string
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) occupation!: string
  @ApiProperty() @IsBoolean() hasPets!: boolean
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string

  @ApiProperty({ example: 'rental-review-v1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  disclosureVersion!: string

  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  acknowledgedDisclosureIds!: string[]
}
