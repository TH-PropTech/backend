import { ApiProperty } from '@nestjs/swagger'
import { IsMongoId } from 'class-validator'

export class AnalyzeConditionDto {
  @ApiProperty({ description: 'Apartment associated with the uploaded image' })
  @IsMongoId()
  apartmentId!: string
}
