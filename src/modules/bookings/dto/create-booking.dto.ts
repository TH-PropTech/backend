import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsIn,
  IsOptional,
} from 'class-validator'

export class CreateBookingDto {
  @ApiProperty({ description: 'ID căn hộ muốn xem' })
  @IsNotEmpty()
  @IsString()
  apartmentId!: string

  @ApiProperty({ description: 'Thời điểm hẹn xem nhà (ISO 8601)' })
  @IsNotEmpty()
  @IsDateString()
  visitAt!: string

  @ApiProperty({ enum: ['onsite', 'video'], description: 'Hình thức xem' })
  @IsIn(['onsite', 'video'])
  method!: 'onsite' | 'video'

  @ApiPropertyOptional({ description: 'Ghi chú thêm' })
  @IsOptional()
  @IsString()
  note?: string | null | undefined

  @ApiPropertyOptional({ description: 'Họ tên khách thuê' })
  @IsOptional()
  @IsString()
  tenantName?: string | null | undefined

  @ApiPropertyOptional({ description: 'Số điện thoại khách thuê' })
  @IsOptional()
  @IsString()
  tenantPhone?: string | null | undefined
}
