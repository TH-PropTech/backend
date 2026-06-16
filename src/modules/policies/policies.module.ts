import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Policy } from './schemas/policy.schema'
import { PoliciesService } from './policies.service'
import { PoliciesController } from './policies.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Policy])],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
