import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Booking } from './schemas/booking.schema'
import { ViewingNote } from './schemas/viewing-note.schema'
import { Apartment } from '../properties/schemas/apartment.schema'
import { User } from '../users/schemas/user.schema'
import { BookingsService } from './services/bookings.service'
import { ViewingNotesService } from './services/viewing-notes.service'
import { BookingsController } from './controllers/bookings.controller'
import { ViewingNotesController } from './controllers/viewing-notes.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { PropertiesModule } from '../properties/properties.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Apartment, User, ViewingNote]),
    NotificationsModule,
    PropertiesModule,
  ],
  providers: [BookingsService, ViewingNotesService],
  controllers: [BookingsController, ViewingNotesController],
  exports: [TypeOrmModule, BookingsService, ViewingNotesService],
})
export class BookingsModule {}
