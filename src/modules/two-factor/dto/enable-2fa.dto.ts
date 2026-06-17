import { IsString } from 'class-validator'

export class Enable2faDto {
  @IsString()
  token!: string
}
