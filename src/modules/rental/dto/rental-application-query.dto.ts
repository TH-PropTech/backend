import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import type { RentalApplicationStatus } from '../schemas/rental-application.schema'

export class RentalApplicationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'accepted', 'rejected'] })
  @IsOptional()
  @IsEnum(['pending', 'accepted', 'rejected'])
  status?: RentalApplicationStatus
}
