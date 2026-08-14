import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import type {
  ListingReviewStatus,
  ListingReviewType,
} from '../schemas/listing-review-case.schema'

const REVIEW_TYPES = [
  'stale',
  'duplicate_photo',
  'duplicate_location',
  'duplicate_phone',
  'similar_content',
] as const

const REVIEW_STATUSES = ['pending', 'confirmed', 'dismissed'] as const

export class ListingReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: REVIEW_TYPES })
  @IsOptional()
  @IsEnum(REVIEW_TYPES)
  type?: ListingReviewType

  @ApiPropertyOptional({ enum: REVIEW_STATUSES })
  @IsOptional()
  @IsEnum(REVIEW_STATUSES)
  status?: ListingReviewStatus
}

export class ReviewListingCaseDto {
  @ApiProperty({ enum: ['confirmed', 'dismissed'] })
  @IsEnum(['confirmed', 'dismissed'])
  status!: Exclude<ListingReviewStatus, 'pending'>
}
