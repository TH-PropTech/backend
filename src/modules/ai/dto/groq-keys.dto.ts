import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator'
import type { CheckResult } from '../utils/groq-probe'
import type { GroqKeyAction } from '../utils/groq-keys.types'

/** Groq key format: gsk_ followed by 20-200 alphanumerics. */
export const GROQ_KEY_PATTERN = /^gsk_[A-Za-z0-9]{20,200}$/

const trimStrings = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    return (value as unknown[]).map(item =>
      typeof item === 'string' ? item.trim() : item
    )
  }
  return value
}

export class AddGroqKeysDto {
  @ArrayMinSize(1)
  @IsArray()
  @Transform(trimStrings)
  @Matches(GROQ_KEY_PATTERN, {
    each: true,
    message: 'Có key sai định dạng (gsk_...)',
  })
  keys!: string[]

  /** Optional probe results obtained from the "Kiểm tra" step, keyed by raw key. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  checks?: Record<string, CheckResult>
}

export class CheckGroqKeyDto {
  /** Raw key to probe without saving it. */
  @IsOptional()
  @Transform(trimStrings)
  @Matches(GROQ_KEY_PATTERN, {
    message: 'Key sai định dạng (gsk_...)',
  })
  key?: string

  /** Saved key to probe; the result is stored on the document. */
  @IsOptional()
  @IsString()
  id?: string
}

export class PatchGroqKeyDto {
  @IsIn(['disable', 'enable', 'reset'])
  action!: GroqKeyAction
}
