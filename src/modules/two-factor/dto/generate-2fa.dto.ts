import { IsString } from 'class-validator'

export class Generate2faDto {
  @IsString()
  userId!: string
}
