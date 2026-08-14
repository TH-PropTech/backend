import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApartmentsModule } from '../apartments/apartments.module'
import { BookingsModule } from '../bookings/bookings.module'
import { ViewingNote } from './schemas/viewing-note.schema'
import { ViewingNotesController } from './viewing-notes.controller'
import { ViewingNotesService } from './viewing-notes.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([ViewingNote]),
    ApartmentsModule,
    BookingsModule,
  ],
  controllers: [ViewingNotesController],
  providers: [ViewingNotesService],
  exports: [TypeOrmModule, ViewingNotesService],
})
export class ViewingNotesModule {}
