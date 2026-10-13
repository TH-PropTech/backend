import { SkipThrottle } from '@nestjs/throttler'
import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiTags } from '@nestjs/swagger'
import { HealthResponseDto } from '../dto/health-response.dto'
import { HealthService } from '../services/health.service'
import { Public } from '../../../common/decorators/public.decorator'

@ApiTags('health')
@SkipThrottle()
@Controller({
  path: 'health',
  version: '1',
})
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponseDto {
    return this.healthService.getHealth()
  }
}
