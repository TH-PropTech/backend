import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Contract } from './schemas/contract.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Contract])],
  exports: [TypeOrmModule],
})
export class ContractsModule {}
