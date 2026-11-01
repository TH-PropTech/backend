import { ApiProperty } from '@nestjs/swagger'

export class SessionItemDto {
  @ApiProperty({
    description: 'ID của phiên đăng nhập',
    example: '6724cb11...',
  })
  id!: string

  @ApiProperty({
    description: 'Nhãn thiết bị',
    example: 'Chrome trên Windows',
  })
  deviceLabel!: string

  @ApiProperty({
    description: 'Địa chỉ IP đã che octet cuối',
    example: '113.161.45.*',
  })
  ipMasked!: string

  @ApiProperty({
    description: 'Thời điểm hoạt động cuối cùng',
  })
  lastActiveAt!: Date

  @ApiProperty({
    description: 'Đánh dấu có phải phiên hiện tại của yêu cầu hay không',
    example: true,
  })
  isCurrent!: boolean
}

export class SessionListResponseDto {
  @ApiProperty({ type: [SessionItemDto] })
  items!: SessionItemDto[]
}
