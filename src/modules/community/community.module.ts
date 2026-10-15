import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { NotificationsModule } from '../notifications/notifications.module'
import { CommunityEntry } from './schemas/community-entry.schema'
import { SupportTicket } from './schemas/support-ticket.schema'
import { Dispute } from './schemas/dispute.schema'
import { CommunityService } from './services/community.service'
import { SupportTicketsService } from './services/support-tickets.service'
import { CommunityController } from './controllers/community.controller'
import { SupportTicketsController } from './controllers/support-tickets.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunityEntry, SupportTicket, Dispute]),
    NotificationsModule,
  ],
  providers: [CommunityService, SupportTicketsService],
  controllers: [CommunityController, SupportTicketsController],
  exports: [TypeOrmModule, CommunityService, SupportTicketsService],
})
export class CommunityModule {}
