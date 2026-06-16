import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { IsString, IsNotEmpty } from 'class-validator'
import { PoliciesService } from './policies.service'
import { Policy } from './schemas/policy.schema'

export class UpdatePolicyDto {
  @IsString()
  @IsNotEmpty()
  value!: string
}

@ApiTags('policies')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Get()
  async getAllPolicies(): Promise<Policy[]> {
    return this.policiesService.findAll()
  }

  @Get(':key')
  async getPolicyByKey(@Param('key') key: string): Promise<Policy> {
    return this.policiesService.findOne(key)
  }

  @Put(':key')
  async updatePolicy(
    @Param('key') key: string,
    @Body() dto: UpdatePolicyDto
  ): Promise<Policy> {
    try {
      return await this.policiesService.update(key, dto.value, 'admin')
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      throw new NotFoundException(`Cập nhật chính sách thất bại: ${errMsg}`)
    }
  }
}
