import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export const STATEMENT_MAX_LINES = 50
export const STATEMENT_LINE_MAX_FILES = 5
/** Ảnh JPEG/PNG; kích thước 5 MB do `POST /apartments/upload` giới hạn. */
const IMAGE_URL_PATH = /\.(jpe?g|png)$/i

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

export class StatementLineDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  amount!: number

  @ApiPropertyOptional({ type: [String], maxItems: STATEMENT_LINE_MAX_FILES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STATEMENT_LINE_MAX_FILES)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @Matches(IMAGE_URL_PATH, {
    each: true,
    message: 'evidenceUrls must point to JPEG or PNG images',
  })
  evidenceUrls?: string[]
}

export class SaveStatementDraftDto {
  @ApiProperty({ type: [StatementLineDto], maxItems: STATEMENT_MAX_LINES })
  @IsArray()
  @ArrayMaxSize(STATEMENT_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StatementLineDto)
  lines!: StatementLineDto[]
}

export class LineResponseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  lineId!: string

  @ApiProperty({ enum: ['accept', 'reject'] })
  @IsIn(['accept', 'reject'])
  decision!: 'accept' | 'reject'

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  note?: string
}

export class RespondStatementDto {
  @ApiProperty({ type: [LineResponseDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STATEMENT_MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => LineResponseDto)
  responses!: LineResponseDto[]
}

/** Không có trường tệp: `forbidNonWhitelisted` từ chối mọi đính kèm. */
export class RecordRefundDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  amount!: number

  @ApiProperty({ maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  transactionRef!: string

  @ApiProperty({ example: '2030-02-05T09:00:00.000Z' })
  @IsISO8601({ strict: true })
  paidAt!: string

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string
}
