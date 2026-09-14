import { IsNumber, Min } from 'class-validator'

export class PublishFlowProfileDto {
  @IsNumber()
  @Min(1)
  expectedRevision!: number
}
