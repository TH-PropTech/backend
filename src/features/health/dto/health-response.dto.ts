import { ApiProperty } from '@nestjs/swagger'

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok'

  @ApiProperty({ example: '2026-06-08T04:30:00.000Z' })
  timestamp!: string

  @ApiProperty({ example: 12.34 })
  uptimeSeconds!: number
}
