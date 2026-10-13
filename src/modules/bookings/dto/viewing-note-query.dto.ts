import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'

export class ViewingNoteQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apartmentId?: string
}
