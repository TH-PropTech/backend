import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Building } from './schemas/building.schema'
import { BuildingsService } from './buildings.service'
import { BuildingsController } from './buildings.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Building])],
  providers: [BuildingsService],
  controllers: [BuildingsController],
  exports: [TypeOrmModule, BuildingsService],
})
export class BuildingsModule {}
