import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import type { PushPlatform } from '../schemas/push-token.schema'

export const PUSH_PLATFORMS: readonly PushPlatform[] = ['ios', 'android']

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token!: string

  @ApiPropertyOptional({ enum: PUSH_PLATFORMS })
  @IsOptional()
  @IsIn(PUSH_PLATFORMS)
  platform?: PushPlatform
}
