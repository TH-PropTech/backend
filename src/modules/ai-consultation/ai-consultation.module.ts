import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from '../users/schemas/user.schema'
import { AiConsultationLog } from './schemas/ai-consultation-log.schema'
import { AiConsultationController } from './ai-consultation.controller'
import { AiConsultationGateway } from './ai-consultation.gateway'
import { AiConsultationService } from './services/ai-consultation.service'
import { SttService } from './services/stt.service'
import { TtsService } from './services/tts.service'
import { VadService } from './services/vad.service'
import { GroqLlmService } from './services/groq-llm.service'
import { ConsultationEmailService } from './services/consultation-email.service'

@Module({
  imports: [TypeOrmModule.forFeature([AiConsultationLog, User])],
  controllers: [AiConsultationController],
  providers: [
    AiConsultationService,
    SttService,
    TtsService,
    VadService,
    GroqLlmService,
    ConsultationEmailService,
    AiConsultationGateway,
  ],
  exports: [AiConsultationService],
})
export class AiConsultationModule {}
