import { Injectable } from '@nestjs/common'
import { HealthResponseDto } from './dto/health-response.dto'

@Injectable()
export class HealthService {
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(2)),
    }
  }
}
