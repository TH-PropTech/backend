import { IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class PublishTermsDto {
  @IsNumber()
  @Min(1)
  expectedRevision!: number

  /** ISO date-time; vắng mặt = hiệu lực ngay. Khoảng hợp lệ do service kiểm (TERMS_EFFECTIVE_FROM_INVALID). */
  @IsOptional()
  @IsString()
  effectiveFrom?: string
}
