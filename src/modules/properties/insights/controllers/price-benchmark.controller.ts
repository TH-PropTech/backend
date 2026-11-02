import { Controller, Get, Query } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { BenchmarkQueryDto } from '../dto/benchmark-query.dto'
import { BenchmarkResponseDto } from '../dto/benchmark-response.dto'
import { PriceBenchmarkService } from '../services/price-benchmark.service'
import { Public } from '../../../../common/decorators/public.decorator'
import { ReadCacheService } from '../../../health/services/read-cache.service'
import { APARTMENT_CACHE_NAMESPACE } from '../../../read-model/services/apartment-cache-invalidator.service'

@ApiTags('price-benchmark')
@Controller('price-benchmark')
export class PriceBenchmarkController {
  constructor(
    private readonly priceBenchmarkService: PriceBenchmarkService,
    private readonly readCache: ReadCacheService
  ) {}

  /** GET /api/v1/price-benchmark — Benchmark giá thuê [uc_customer_apartment] [uc_search] */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Tính benchmark giá thuê theo khu vực' })
  @ApiOkResponse({ type: BenchmarkResponseDto })
  async calculate(
    @Query() query: BenchmarkQueryDto
  ): Promise<BenchmarkResponseDto> {
    return this.readCache.wrap(
      APARTMENT_CACHE_NAMESPACE,
      { kind: 'price-benchmark', query },
      () => this.priceBenchmarkService.calculateBenchmark(query)
    )
  }
}
