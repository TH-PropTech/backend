import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator'

export class PublishRentalExecutionPolicyDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number

  @IsString()
  @IsNotEmpty()
  reason!: string
}
