import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../../common/decorators/roles.decorator'
import { RolesGuard } from '../../../common/guards/roles.guard'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import type { JobRunOutcome } from '../base-job'
import type { JobRunHistory } from '../schemas/job-run-history.schema'
import {
  JobManagerService,
  type JobStatus,
} from '../services/job-manager.service'

/** Quản trị job nền — chỉ Admin. */
@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobManager: JobManagerService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách job nền và trạng thái bật/tắt' })
  list(): JobStatus[] {
    return this.jobManager.list()
  }

  @Get(':name/history')
  @ApiOperation({ summary: 'Lịch sử chạy của một job' })
  history(
    @Param('name') name: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number
  ): Promise<JobRunHistory[]> {
    return this.jobManager.history(name, limit)
  }

  @Post(':name/enable')
  @ApiOperation({ summary: 'Bật lịch chạy của job' })
  enable(@Param('name') name: string): Promise<JobStatus> {
    return this.jobManager.enable(name)
  }

  @Post(':name/disable')
  @ApiOperation({ summary: 'Tắt lịch chạy của job' })
  disable(@Param('name') name: string): Promise<JobStatus> {
    return this.jobManager.disable(name)
  }

  @Post(':name/run')
  @ApiOperation({ summary: 'Chạy tay job ngay lập tức' })
  run(@Param('name') name: string): Promise<JobRunOutcome> {
    return this.jobManager.runNow(name)
  }
}
