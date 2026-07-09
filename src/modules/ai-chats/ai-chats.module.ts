import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiChat } from './schemas/ai-chat.schema'
import { User } from '../users/schemas/user.schema'
import { AiChatsController } from './ai-chats.controller'
import { AiChatsGateway } from './ai-chats.gateway'
import { AiChatsService } from './services/ai-chats.service'
import { GroqAgentService } from './services/groq-agent.service'
import { ApartmentsModule } from '../apartments/apartments.module'
import { BookingsModule } from '../bookings/bookings.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([AiChat, User]),
    ApartmentsModule,
    BookingsModule,
  ],
  controllers: [AiChatsController],
  providers: [AiChatsGateway, AiChatsService, GroqAgentService],
  exports: [TypeOrmModule, AiChatsService],
})
export class AiChatsModule {}
