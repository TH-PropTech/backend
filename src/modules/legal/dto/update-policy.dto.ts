import { IsString, IsNotEmpty, IsIn } from 'class-validator'

export class UpdatePolicyDto {
  @IsString()
  @IsNotEmpty()
  value!: string
}

export class UpdatePolicyStatusDto {
  @IsString()
  @IsIn(['active', 'inactive'])
  status!: 'active' | 'inactive'
}

export interface PublicPolicyItem {
  key: string
  value: string
  description: string
  unit?: string
  legalReference?: string
}
