import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
} from 'class-validator'

export class SubmitKycDto {
  @ApiProperty({ description: 'Số CCCD/CMND' })
  @IsString()
  @IsNotEmpty()
  idCardNumber!: string

  @ApiProperty({ description: 'URL hoặc base64 ảnh mặt trước CCCD' })
  @IsString()
  @IsNotEmpty()
  frontCardUrl!: string

  @ApiProperty({ description: 'URL hoặc base64 ảnh mặt sau CCCD' })
  @IsString()
  @IsNotEmpty()
  backCardUrl!: string

  @ApiProperty({ description: 'URL hoặc base64 ảnh selfie' })
  @IsString()
  @IsNotEmpty()
  selfieUrl!: string

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

  @ApiPropertyOptional({ description: 'Kết quả so khớp khuôn mặt' })
  @IsOptional()
  @IsBoolean()
  faceMatchResult?: boolean

  @ApiPropertyOptional({ description: 'Kết quả Liveness Detection' })
  @IsOptional()
  @IsBoolean()
  livenessResult?: boolean

  @ApiPropertyOptional({ description: 'Điểm anti-spoofing' })
  @IsOptional()
  @IsNumber()
  spoofScore?: number

  @ApiPropertyOptional({ description: 'Tỷ lệ khớp OCR' })
  @IsOptional()
  @IsNumber()
  ocrMatchRate?: number
}
