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
  IsIn,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/rental-execution-policy.util'

class SelectedExecutionPolicyRefDto implements RentalExecutionPolicyRef {
  @IsString()
  @IsNotEmpty()
  policyId!: string

  @IsInt()
  @Min(1)
  version!: number

  @IsIn(['DEPOSIT_FIRST', 'SIGN_FIRST'])
  strategy!: RentalExecutionPolicyRef['strategy']

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  contentHash!: string
}

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

  @ApiPropertyOptional({
    description: 'Terms of service version observed by tenant',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  acceptedTermsVersion?: number

  @ApiPropertyOptional({ description: 'SHA-256 hash of accepted terms' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  acceptedTermsHash?: string

  @ApiPropertyOptional({ description: 'Observed Flow Profile Version' })
  @IsOptional()
  @IsInt()
  @Min(1)
  flowProfileVersion?: number

  @ApiPropertyOptional({ description: 'Observed Flow Profile Hash (SHA-256)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  flowProfileHash?: string

  @ApiPropertyOptional({
    description: 'Execution policy selected in Step 2 and confirmed in Step 3',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SelectedExecutionPolicyRefDto)
  selectedExecutionPolicy?: SelectedExecutionPolicyRefDto
}
