import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AiChat } from './schemas/ai-chat.schema'

@Module({
  imports: [TypeOrmModule.forFeature([AiChat])],
  exports: [TypeOrmModule],
})
export class AiChatsModule {}
