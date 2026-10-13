import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from './common/decorators/public.decorator'

@ApiTags('root')
@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  constructor(private readonly configService: ConfigService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Thông tin chung về API' })
  @ApiOkResponse({ description: 'Thông tin API và môi trường vận hành' })
  getInfo(): {
    name: string
    environment: string
    endpoints: Record<string, string>
  } {
    return {
      name: 'TH PropTech API',
      environment: this.configService.get<string>('app.env') ?? 'local',
      endpoints: {
        health: '/api/v1/health',
        docs: '/api/docs',
      },
    }
  }
}
