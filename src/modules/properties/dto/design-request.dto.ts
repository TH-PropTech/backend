import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator'
import {
  DESIGN_REQUEST_KINDS,
  DESIGN_REQUEST_STATUSES,
  MAX_DESIGN_REQUEST_ATTACHMENTS,
  type DesignRequestKind,
  type DesignRequestStatus,
} from '../schemas/design-request.schema'

export const MAX_DESIGN_REQUEST_NOTE = 2000
export const MAX_DESIGN_REQUEST_BRIEF = 2000

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value

const HTTPS_URL = { protocols: ['https'], require_protocol: true }

/** Tách chuỗi trạng thái phân cách bằng dấu phẩy; `null` nếu có giá trị không hợp lệ, `[]` nếu rỗng. */
export function parseDesignRequestStatuses(
  raw: string | undefined
): DesignRequestStatus[] | null {
  if (raw === undefined || raw.trim() === '') return []
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const valid = new Set<string>(DESIGN_REQUEST_STATUSES)
  if (!parts.every(p => valid.has(p))) return null
  return [...new Set(parts)] as DesignRequestStatus[]
}

@ValidatorConstraint({ name: 'designRequestStatusList', async: false })
export class DesignRequestStatusListConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && parseDesignRequestStatuses(value) !== null
    )
  }
  defaultMessage(): string {
    return `status phải là danh sách (phân cách bằng dấu phẩy) gồm: ${DESIGN_REQUEST_STATUSES.join(', ')}`
  }
}

export class CreateDesignRequestDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  apartmentId!: string

  @ApiProperty({ enum: DESIGN_REQUEST_KINDS })
  @IsIn(DESIGN_REQUEST_KINDS as readonly string[])
  kind!: DesignRequestKind

  @ApiPropertyOptional({ description: 'Bắt buộc khi kind = edit' })
  @ValidateIf(
    (o: CreateDesignRequestDto) =>
      o.kind === 'edit' || o.targetDesignId !== undefined
  )
  @IsString()
  @IsNotEmpty()
  targetDesignId?: string

  @ApiProperty({ maxLength: MAX_DESIGN_REQUEST_BRIEF })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESIGN_REQUEST_BRIEF)
  brief!: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DESIGN_REQUEST_ATTACHMENTS)
  @IsUrl(HTTPS_URL, { each: true })
  attachmentUrls?: string[]
}

/** Ghi chú bắt buộc (+ đính kèm tuỳ chọn): reply, feedback, request-info, reject. */
export class DesignRequestNoteDto {
  @ApiProperty({ maxLength: MAX_DESIGN_REQUEST_NOTE })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESIGN_REQUEST_NOTE)
  note!: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_DESIGN_REQUEST_ATTACHMENTS)
  @IsUrl(HTTPS_URL, { each: true })
  attachmentUrls?: string[]
}

/** Ghi chú tuỳ chọn: escalate. */
export class DesignRequestOptionalNoteDto {
  @ApiPropertyOptional({ maxLength: MAX_DESIGN_REQUEST_NOTE })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESIGN_REQUEST_NOTE)
  note?: string
}

export class DeliverDesignRequestDto extends DesignRequestOptionalNoteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  designId!: string
}

export class MyDesignRequestsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apartmentId?: string

  @ApiPropertyOptional({ enum: DESIGN_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(DESIGN_REQUEST_STATUSES as readonly string[])
  status?: DesignRequestStatus

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

export class DesignRequestQueueQueryDto {
  @ApiPropertyOptional({
    description:
      'Danh sách trạng thái phân cách bằng dấu phẩy; mặc định = mọi trạng thái chưa kết thúc',
  })
  @IsOptional()
  @Validate(DesignRequestStatusListConstraint)
  status?: string

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
