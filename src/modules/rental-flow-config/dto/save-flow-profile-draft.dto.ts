import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import type {
  FlowChangeClassification,
  FlowProfileSteps,
} from '../schemas/rental-flow-profile.schema'

export class SaveFlowProfileDraftDto {
  @IsString()
  @IsOptional()
  profileId?: string

  @IsString()
  @IsNotEmpty()
  name!: string

  @IsString()
  @IsOptional()
  description?: string

  @IsEnum(['PRESENTATION', 'APPLICATION_RULE', 'CONTRACT_MATERIAL'])
  changeClassification!: FlowChangeClassification

  @IsNumber()
  @Min(1)
  expectedRevision!: number

  @IsObject()
  steps!: FlowProfileSteps
}
