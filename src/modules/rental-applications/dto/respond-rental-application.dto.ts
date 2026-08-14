import { ApiProperty } from '@nestjs/swagger'
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class RespondRentalApplicationDto {
  @ApiProperty({ enum: ['accepted', 'rejected'] })
  @IsEnum(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected'

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reasonCode!: string
}
