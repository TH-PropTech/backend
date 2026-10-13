import { IsNumber, Min } from 'class-validator'

export class PublishTermsDto {
  @IsNumber()
  @Min(1)
  expectedRevision!: number
}
