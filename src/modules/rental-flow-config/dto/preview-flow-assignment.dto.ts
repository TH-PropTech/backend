import { IsNotEmpty, IsString } from 'class-validator'

export class PreviewFlowAssignmentDto {
  @IsString()
  @IsNotEmpty()
  apartmentId!: string

  @IsString()
  @IsNotEmpty()
  packageId!: string
}
