import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import type {
  RentalExecutionPolicyDisclosure,
  RentalExecutionStrategy,
} from '../rental-execution-policy.util'

export class SaveRentalExecutionPolicyDraftDto {
  @IsString()
  @IsOptional()
  policyId?: string

  @IsEnum(['DEPOSIT_FIRST', 'SIGN_FIRST'])
  strategy!: RentalExecutionStrategy

  @IsString()
  @IsNotEmpty()
  name!: string

  @IsString()
  @IsNotEmpty()
  description!: string

  @IsObject()
  disclosure!: RentalExecutionPolicyDisclosure

  @IsInt()
  @Min(1)
  expectedRevision!: number
}
