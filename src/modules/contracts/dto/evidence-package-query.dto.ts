import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, Max, Min } from 'class-validator'

export class EvidencePackageQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Phiên bản (revision) artifact canonical cần xuất; bỏ trống = phiên bản hiện hành',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  revision?: number
}
