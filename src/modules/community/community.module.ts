import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { NotificationsModule } from '../notifications/notifications.module'
import { CommunityPost } from './schemas/community-post.schema'
import { CommunityComment } from './schemas/community-comment.schema'
import { SupportTicket } from './schemas/support-ticket.schema'
import { TicketMessage } from './schemas/ticket-message.schema'
import { Dispute } from './schemas/dispute.schema'
import { CommunityService } from './services/community.service'
import { SupportTicketsService } from './services/support-tickets.service'
import { CommunityController } from './controllers/community.controller'
import { SupportTicketsController } from './controllers/support-tickets.controller'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunityPost,
      CommunityComment,
      SupportTicket,
      TicketMessage,
      Dispute,
    ]),
    NotificationsModule,
  ],
  providers: [CommunityService, SupportTicketsService],
  controllers: [CommunityController, SupportTicketsController],
  exports: [TypeOrmModule, CommunityService, SupportTicketsService],
})
export class CommunityModule {}
