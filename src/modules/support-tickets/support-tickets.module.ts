import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SupportTicket } from './schemas/support-ticket.schema'
import { TicketMessage } from './schemas/ticket-message.schema'
import { SupportTicketsService } from './support-tickets.service'
import { SupportTicketsController } from './support-tickets.controller'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([SupportTicket, TicketMessage]),
    NotificationsModule,
  ],
  providers: [SupportTicketsService],
  controllers: [SupportTicketsController],
  exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
