import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { HealthResponseDto } from './dto/health-response.dto'
import { HealthService } from './health.service'

@ApiTags('health')
@Controller({
  path: 'health',
  version: '1',
})
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponseDto {
    return this.healthService.getHealth()
  }
}
