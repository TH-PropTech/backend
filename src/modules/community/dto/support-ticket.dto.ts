import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  IsArray,
  IsBoolean,
} from 'class-validator'
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto'
import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../schemas/support-ticket.schema'

export class CreateSupportTicketDto {
  @ApiProperty({
    enum: [
      'account',
      'listing',
      'booking',
      'payment',
      'kyc',
      'technical',
      'feedback',
    ],
  })
  @IsEnum([
    'account',
    'listing',
    'booking',
    'payment',
    'kyc',
    'technical',
    'feedback',
  ])
  category!: TicketCategory

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Tiêu đề phải có ít nhất 5 ký tự' })
  subject!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Nội dung yêu cầu phải có ít nhất 10 ký tự' })
  description!: string

  @ApiPropertyOptional({
    enum: ['apartment', 'booking', 'contract', 'payment'],
  })
  @IsOptional()
  @IsEnum(['apartment', 'booking', 'contract', 'payment'])
  linkedEntityType?: 'apartment' | 'booking' | 'contract' | 'payment'

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedEntityId?: string

  @ApiPropertyOptional({
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  })
  @IsOptional()
  @IsEnum(['low', 'normal', 'high', 'urgent'])
  priority?: TicketPriority
}

export class AddTicketMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content!: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentUrls?: string[]

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean
}

export class AssignTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  staffId!: string
}

export class EscalateTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  toStaffId!: string

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string
}

export class ResolveTicketDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(5, { message: 'Ghi chú giải quyết phải có ít nhất 5 ký tự' })
  resolutionNote!: string
}

export class SupportTicketQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [
      'open',
      'in_progress',
      'waiting_customer',
      'waiting_staff',
      'escalated',
      'resolved',
      'closed',
    ],
  })
  @IsOptional()
  @IsEnum([
    'open',
    'in_progress',
    'waiting_customer',
    'waiting_staff',
    'escalated',
    'resolved',
    'closed',
  ])
  status?: TicketStatus

  @ApiPropertyOptional({
    enum: [
      'account',
      'listing',
      'booking',
      'payment',
      'kyc',
      'technical',
      'feedback',
    ],
  })
  @IsOptional()
  @IsEnum([
    'account',
    'listing',
    'booking',
    'payment',
    'kyc',
    'technical',
    'feedback',
  ])
  category?: TicketCategory

  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'urgent'] })
  @IsOptional()
  @IsEnum(['low', 'normal', 'high', 'urgent'])
  priority?: TicketPriority

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsEnum(['true', 'false'])
  slaBreached?: string
}
