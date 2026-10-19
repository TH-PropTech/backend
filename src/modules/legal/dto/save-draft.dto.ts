import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export class LegalTermsSectionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  id!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  heading!: string

  @IsString()
  @IsNotEmpty()
  body!: string

  @IsNumber()
  order!: number

  /** `key` của Nguồn pháp lý (kind='source') đang có; backend kiểm tồn tại trước khi lưu. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  sourceKeys?: string[]
}

export class SaveDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  title!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  summary!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LegalTermsSectionDto)
  sections!: LegalTermsSectionDto[]

  @IsNumber()
  @Min(1)
  expectedRevision!: number
}
