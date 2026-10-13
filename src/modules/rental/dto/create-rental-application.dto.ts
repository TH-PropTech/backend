import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ArrayNotEmpty,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsIn,
  IsString,
  Max,
  MaxLength,
  Min,
  Matches,
  ValidateNested,
} from 'class-validator'
import type { RentalExecutionPolicyRef } from '../../rental-flow-config/utils/rental-execution-policy.util'

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

class OccupantDetailDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2100)
  birthYear!: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  relationship!: string
}

class VehicleDto {
  @IsIn(['motorbike', 'car', 'bicycle'])
  type!: 'motorbike' | 'car' | 'bicycle'

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  quantity!: number
}

class EmergencyContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  relationship!: string

  @IsString()
  @Matches(/^\+?[\d\s()-]{8,20}$/)
  phone!: string
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

  @ApiPropertyOptional({ type: [OccupantDetailDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OccupantDetailDto)
  occupantsDetail?: OccupantDetailDto[]

  @ApiPropertyOptional({ type: [VehicleDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => VehicleDto)
  vehicles?: VehicleDto[]

  @ApiPropertyOptional({ type: EmergencyContactDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto

  @ApiPropertyOptional({ enum: [1, 3, 6] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 3, 6])
  selectedPaymentCycleMonths?: 1 | 3 | 6

  @ApiPropertyOptional({ maxLength: 24 })
  @IsOptional()
  @IsString()
  @MaxLength(24)
  viewingBookingId?: string
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  feeScheduleId?: string
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  feeScheduleVersion?: number
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  feeContentHash?: string
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  feeAcknowledgedHash?: string
}
