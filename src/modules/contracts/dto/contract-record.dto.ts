import { ApiProperty } from '@nestjs/swagger'
import { CONTRACT_RECORD_STATUSES } from './contract-records-query.dto'

/**
 * Bản chiếu an toàn của hợp đồng cho danh sách Admin/Staff. Chỉ chứa trường được phép
 * hiển thị: KHÔNG có CCCD, địa chỉ cá nhân, số điện thoại, hash chữ ký hay tham chiếu tệp.
 */
export class ContractRecordDto {
  @ApiProperty() id!: string
  @ApiProperty() contractCode!: string
  @ApiProperty() propertyId!: string
  @ApiProperty() propertyTitle!: string
  @ApiProperty() landlordId!: string
  @ApiProperty({ nullable: true, type: String }) landlordName!: string | null
  @ApiProperty() tenantId!: string
  @ApiProperty({ nullable: true, type: String }) tenantName!: string | null
  @ApiProperty({ type: String, format: 'date-time' }) startDate!: Date
  @ApiProperty({ type: String, format: 'date-time' }) endDate!: Date
  @ApiProperty({ enum: CONTRACT_RECORD_STATUSES }) status!: string
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Revision PDF canonical mới nhất; null khi chưa có bản PDF',
  })
  latestRevision!: number | null
  @ApiProperty({ description: 'Đã có ít nhất một bản đã ký' })
  hasSigned!: boolean
}

export class ContractRecordsPageDto {
  @ApiProperty({ type: [ContractRecordDto] }) items!: ContractRecordDto[]
  @ApiProperty() total!: number
  @ApiProperty() page!: number
  @ApiProperty() pageSize!: number
}
