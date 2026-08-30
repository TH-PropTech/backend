import { IsObject } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class UpdateUserPermissionsDto {
  @ApiProperty({
    description:
      'Ma trận phân quyền dạng key-value. Key: "module:action", Value: boolean.',
    example: {
      'apartments:view': true,
      'apartments:create': false,
      'apartments:approve': true,
      'kyc:view': true,
      'bookings:view': true,
    },
  })
  @IsObject()
  permissions!: Record<string, boolean>
}
