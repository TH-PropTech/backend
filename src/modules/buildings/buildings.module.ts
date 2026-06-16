import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Building } from './schemas/building.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Building])],
  exports: [TypeOrmModule],
})
export class BuildingsModule {}
