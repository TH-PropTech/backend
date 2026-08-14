import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { AreaProfilesController } from './area-profiles.controller'
import { AreaProfilesService } from './area-profiles.service'
import { AreaProfile } from './schemas/area-profile.schema'
@Module({
  imports: [TypeOrmModule.forFeature([AreaProfile]), ApartmentsModule],
  controllers: [AreaProfilesController],
  providers: [AreaProfilesService],
  exports: [AreaProfilesService],
})
export class AreaProfilesModule {}
