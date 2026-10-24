import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'

export class CreatePostDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  projectName!: string

  @ApiProperty({ enum: ['qa', 'review', 'roommate'] })
  @IsEnum(['qa', 'review', 'roommate'])
  topic!: 'qa' | 'review' | 'roommate'

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsOptional()
  images?: string[]

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @IsOptional()
  tags?: string[]
}
