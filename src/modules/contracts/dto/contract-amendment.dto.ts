import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'

export class ContractAmendmentChangeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  field!: string

  @ApiProperty()
  @IsOptional()
  after!: unknown
}

export class CreateContractAmendmentDto {
  @ApiProperty({ type: [ContractAmendmentChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContractAmendmentChangeDto)
  changes!: ContractAmendmentChangeDto[]

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idempotencyKey?: string
}

export class UpdateContractAmendmentDto extends CreateContractAmendmentDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number
}

export class AmendmentActionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedRevision!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string
}

export class SignContractAmendmentDto extends AmendmentActionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  signatureHash!: string
}
