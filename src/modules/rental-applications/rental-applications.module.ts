import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { RentalApplicationsController } from './rental-applications.controller'
import { RentalApplicationsService } from './rental-applications.service'
import { RentalApplication } from './schemas/rental-application.schema'

@Module({
  imports: [TypeOrmModule.forFeature([RentalApplication]), ApartmentsModule],
  controllers: [RentalApplicationsController],
  providers: [RentalApplicationsService],
  exports: [RentalApplicationsService],
})
export class RentalApplicationsModule {}
