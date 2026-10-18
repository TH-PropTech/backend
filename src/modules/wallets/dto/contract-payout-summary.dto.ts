import { ApiProperty } from '@nestjs/swagger'

export class ContractPayoutSummaryWalletDto {
  @ApiProperty({ description: 'Chủ nhà đã liên kết ví nhận tiền hay chưa' })
  linked!: boolean
}

export class ContractPayoutSummaryItemDto {
  @ApiProperty({ enum: ['DEPOSIT', 'RENT'] })
  kind!: 'DEPOSIT' | 'RENT'

  @ApiProperty({ description: 'Id nguồn: thỏa thuận cọc hoặc Payment kỳ thuê' })
  ref!: string

  @ApiProperty()
  label!: string

  @ApiProperty({ type: String, nullable: true })
  dueAt!: string | null

  @ApiProperty()
  sentAmount!: number

  @ApiProperty()
  receivedAmount!: number

  @ApiProperty({
    description:
      'Trạng thái payout, trạng thái ký quỹ cọc, hoặc "unpaid" khi chưa có khoản nào được tạo',
  })
  status!: string
}

export class ContractPayoutSummaryTotalsDto {
  @ApiProperty()
  received!: number

  @ApiProperty()
  pending!: number
}

export class ContractPayoutSummaryDto {
  @ApiProperty()
  contractId!: string

  @ApiProperty({ type: ContractPayoutSummaryWalletDto })
  wallet!: ContractPayoutSummaryWalletDto

  @ApiProperty({ type: [ContractPayoutSummaryItemDto] })
  items!: ContractPayoutSummaryItemDto[]

  @ApiProperty({ type: ContractPayoutSummaryTotalsDto })
  totals!: ContractPayoutSummaryTotalsDto
}
