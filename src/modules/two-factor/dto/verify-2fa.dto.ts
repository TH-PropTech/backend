import { IsString } from 'class-validator'

export class Verify2faDto {
  @IsString()
  token!: string
}
