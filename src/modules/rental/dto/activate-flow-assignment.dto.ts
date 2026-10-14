import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import type { FlowAssignmentScope } from '../schemas/rental-flow-assignment.schema'

export class ActivateFlowAssignmentDto {
  @IsEnum(['GLOBAL', 'DURATION', 'PACKAGE'])
  scope!: FlowAssignmentScope

  @IsString()
  @IsOptional()
  scopeValue?: string | null

  @IsString()
  @IsNotEmpty()
  profileId!: string

  @IsNumber()
  @Min(1)
  version!: number

  @IsDateString()
  @IsOptional()
  effectiveAt?: string
}
