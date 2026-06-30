import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'
import { PoliciesModule } from '../policies/policies.module'
import { FabricModule } from '../fabric/fabric.module'
import { KycModule } from '../kyc/kyc.module'
import { ContractsService } from './contracts.service'
import { ContractsController } from './contracts.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([Contract]),
    PoliciesModule,
    FabricModule,
    KycModule,
  ],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
