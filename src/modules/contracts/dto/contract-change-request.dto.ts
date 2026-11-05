import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ContractChangeRequestChangeDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  field!: string

  @ApiProperty({ description: 'Giá trị mới của trường' })
  @IsOptional()
  after!: unknown
}

export class CreateContractChangeRequestDto {
  @ApiProperty({ type: [ContractChangeRequestChangeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ContractChangeRequestChangeDto)
  changes!: ContractChangeRequestChangeDto[]

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string

  @ApiProperty({
    minimum: 0,
    description: 'commercialRevision của bản nháp mà yêu cầu dựa trên',
  })
  @IsInt()
  @Min(0)
  expectedRevision!: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string
}

export class ContractChangeRequestDecisionDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string
}
