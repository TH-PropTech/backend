import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  MaxLength,
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
