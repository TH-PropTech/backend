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
  RBAC_ACTIONS,
  RBAC_SUBJECTS,
  type RbacAction,
  type RbacSubject,
} from '../rbac.constants'

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
