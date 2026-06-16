import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'
import { PoliciesModule } from '../policies/policies.module'
import { FabricModule } from '../fabric/fabric.module'
import { ContractsService } from './contracts.service'
import { ContractsController } from './contracts.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Contract]), PoliciesModule, FabricModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
