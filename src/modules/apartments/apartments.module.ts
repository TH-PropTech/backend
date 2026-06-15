import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'

@Module({
  imports: [TypeOrmModule.forFeature([Apartment])],
  exports: [TypeOrmModule],
})
export class ApartmentsModule {}
