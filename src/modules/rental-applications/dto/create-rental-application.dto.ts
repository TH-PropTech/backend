import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
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
  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  occupants!: number
  @ApiProperty() @IsDateString() moveInDate!: string
  @ApiProperty({ minimum: 1, maximum: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  leaseDurationMonths!: number
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) occupation!: string
  @ApiProperty() @IsBoolean() hasPets!: boolean
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string
}
