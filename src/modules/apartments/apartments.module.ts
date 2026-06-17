import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { ApartmentsService } from './apartments.service'
import { ApartmentsController } from './apartments.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Apartment])],
  providers: [ApartmentsService],
  controllers: [ApartmentsController],
  exports: [TypeOrmModule, ApartmentsService],
})
export class ApartmentsModule {}
