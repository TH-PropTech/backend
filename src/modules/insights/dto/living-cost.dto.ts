import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CommuteInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distance?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mode?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyFee?: number
}

export class OneTimeCostInputDto {
  @ApiProperty()
  @IsString()
  name!: string

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number
}

export class CalculateLivingCostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apartmentId?: string

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyRent!: number

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  serviceFee?: number

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  parkingFee?: number

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  internetFee?: number

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CommuteInputDto)
  commuteEstimate?: CommuteInputDto

  @ApiPropertyOptional({ type: [OneTimeCostInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OneTimeCostInputDto)
  oneTimeCosts?: OneTimeCostInputDto[]

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  occupants?: number

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudget?: number
}

export class CreateLivingCostProfileDto extends CalculateLivingCostDto {
  @ApiProperty()
  @IsString()
  name!: string
}
