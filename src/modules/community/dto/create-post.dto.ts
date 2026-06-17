import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'

export class CreatePostDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  projectName!: string

  @ApiProperty({ enum: ['qa', 'review', 'roommate'] })
  @IsEnum(['qa', 'review', 'roommate'])
  topic!: 'qa' | 'review' | 'roommate'

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[]
}
