import { IsString } from 'class-validator'

export class Verify2faDto {
  @IsString()
  userId!: string

  @IsString()
  token!: string
}
