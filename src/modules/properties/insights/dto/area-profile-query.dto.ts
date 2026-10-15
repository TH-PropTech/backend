import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'
import { PaginationQueryDto } from '../../../../common/dto/pagination-query.dto'
export class AreaProfileQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() district?: string
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string
}
