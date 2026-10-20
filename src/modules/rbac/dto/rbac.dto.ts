import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import {
  MANAGED_ROLES,
  RBAC_ACTIONS,
  RBAC_SUBJECTS,
  type RbacAction,
  type RbacSubject,
} from '../rbac.constants'

/** Mã vai trò tùy chỉnh: chữ thường, số, gạch ngang hoặc gạch dưới, bắt đầu bằng chữ. */
export const CUSTOM_ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]{2,39}$/
export const RESERVED_ROLE_NAMES = [
  'admin',
  'tenant',
  'landlord',
  'staff',
  'all',
  'me',
] as const

export class CreateRoleDto {
  @ApiProperty({ example: 'auditor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string

  @ApiPropertyOptional({ example: 'Nhân viên KYC' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label?: string

  @ApiPropertyOptional({
    enum: MANAGED_ROLES,
    description:
      'Có giá trị thì tạo vai trò tùy chỉnh dựa trên vai trò gốc này (sao chép quyền hiện tại của vai trò gốc).',
  })
  @IsOptional()
  @IsIn(MANAGED_ROLES)
  baseRole?: (typeof MANAGED_ROLES)[number]
}

export class SetRoleUsersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  userIds!: string[]
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class PermissionInputDto {
  @ApiProperty({ enum: RBAC_ACTIONS })
  @IsIn(RBAC_ACTIONS)
  action!: RbacAction

  @ApiProperty({ enum: RBAC_SUBJECTS })
  @IsIn(RBAC_SUBJECTS)
  subject!: RbacSubject

  @ApiProperty()
  @IsBoolean()
  allowed!: boolean
}

export class SetPermissionsDto {
  @ApiProperty({ type: [PermissionInputDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PermissionInputDto)
  permissions!: PermissionInputDto[]
}
