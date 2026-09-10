import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsOptional } from 'class-validator'

export class SubmitKycDto {
  @ApiProperty({ description: 'Số CCCD/CMND' })
  @IsString()
  @IsNotEmpty()
  idCardNumber!: string

  @ApiPropertyOptional({ description: 'Họ tên trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  fullName?: string

  @ApiPropertyOptional({ description: 'Ngày sinh trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string

  @ApiPropertyOptional({ description: 'Giới tính trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  gender?: string

  @ApiPropertyOptional({ description: 'Quốc tịch trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  nationality?: string

  @ApiPropertyOptional({ description: 'Quê quán trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  placeOfOrigin?: string

  @ApiPropertyOptional({ description: 'Nơi thường trú trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  placeOfResidence?: string

  @ApiPropertyOptional({ description: 'Ngày cấp trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  issueDate?: string

  @ApiPropertyOptional({ description: 'Nơi cấp trích xuất từ OCR' })
  @IsOptional()
  @IsString()
  placeOfIssue?: string
}
