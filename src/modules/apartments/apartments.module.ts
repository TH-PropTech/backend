import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Apartment } from './schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { ApartmentsService } from './apartments.service'
import { ApartmentsController } from './apartments.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { ProjectsModule } from '../projects/projects.module'
import { BuildingsModule } from '../buildings/buildings.module'
import { SavedSearchesModule } from '../saved-searches/saved-searches.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Apartment, User]),
    NotificationsModule,
    ProjectsModule,
    BuildingsModule,
    SavedSearchesModule,
  ],
  providers: [ApartmentsService],
  controllers: [ApartmentsController],
  exports: [TypeOrmModule, ApartmentsService],
})
export class ApartmentsModule {}
