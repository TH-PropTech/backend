import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LivingCostProfile } from './schemas/living-cost-profile.schema'
import { LivingCostService } from './living-cost.service'
import { LivingCostController } from './living-cost.controller'

@Module({
  imports: [TypeOrmModule.forFeature([LivingCostProfile])],
  providers: [LivingCostService],
  controllers: [LivingCostController],
  exports: [LivingCostService],
})
export class LivingCostModule {}
