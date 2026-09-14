import { ApiProperty } from '@nestjs/swagger'

export class ContractAuditEventDto {
  @ApiProperty()
  id!: string

  @ApiProperty({
    enum: ['contract', 'signature', 'deposit', 'payment', 'ledger'],
  })
  category!: 'contract' | 'signature' | 'deposit' | 'payment' | 'ledger'

  @ApiProperty()
  eventType!: string

  @ApiProperty({
    enum: ['pending', 'processing', 'confirmed', 'failed', 'informational'],
  })
  status!: 'pending' | 'processing' | 'confirmed' | 'failed' | 'informational'

  @ApiProperty()
  occurredAt!: string

  @ApiProperty({
    nullable: true,
    enum: ['tenant', 'landlord', 'staff', 'system'],
  })
  actorRole!: 'tenant' | 'landlord' | 'staff' | 'system' | null

  @ApiProperty({ nullable: true, enum: ['simulation', 'fabric'] })
  networkMode!: 'simulation' | 'fabric' | null

  @ApiProperty({ nullable: true })
  txHash!: string | null

  @ApiProperty({ nullable: true })
  blockNumber!: number | null

  @ApiProperty()
  retryable!: boolean

  @ApiProperty()
  displayCode!: string

  @ApiProperty()
  description!: string
}
