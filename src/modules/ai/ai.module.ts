import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from '../users/schemas/user.schema'
import { Booking } from '../bookings/schemas/booking.schema'
import { Contract } from '../contracts/schemas/contract.schema'
import { Payment } from '../payments/schemas/payment.schema'
import { PersonalDataService } from './services/personal-data.service'
import { PropertiesModule } from '../properties/properties.module'
import { BookingsModule } from '../bookings/bookings.module'
import { HealthModule } from '../health/health.module'
import { LegalModule } from '../legal/legal.module'
import { ActivityLog } from '../activity-log/schemas/activity-log.schema'
import { SystemConfig } from '../properties/schemas/system-config.schema'
import { GroqKeyRepository } from './utils/groq-key.repository'
import { AiChatsController } from './controllers/ai-chats.controller'
import { AiConsultationController } from './controllers/ai-consultation.controller'
import { AiConsultationGateway } from './gateways/ai-consultation.gateway'
import { AiChatsService } from './services/ai-chats.service'
import { GroqAgentService } from './services/groq-agent.service'
import { AiConsultationService } from './services/ai-consultation.service'
import { SttService } from './services/stt.service'
import { TtsService } from './services/tts.service'
import { VadService } from './services/vad.service'
import { GroqLlmService } from './services/groq-llm.service'
import { ConsultationEmailService } from './services/consultation-email.service'
import { GroqKeyPool } from './services/groq-key-pool.service'
import { GroqKeysService } from './services/groq-keys.service'
import { GROQ_KEY_STORE } from './utils/groq-key-store'

/**
 * AiModule gom groq (key pool/store) + ai-chats + ai-consultation.
 * @Global giữ nguyên hành vi cũ của GroqModule: GroqKeyPool được inject ở
 * ekyc, insights, legal... mà không cần import module.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      ActivityLog,
      SystemConfig,
      Booking,
      Contract,
      Payment,
    ]),
    PropertiesModule,
    BookingsModule,
    HealthModule,
    LegalModule,
  ],
  controllers: [AiChatsController, AiConsultationController],
  providers: [
    AiChatsService,
    PersonalDataService,
    GroqAgentService,
    AiConsultationService,
    SttService,
    TtsService,
    VadService,
    GroqLlmService,
    ConsultationEmailService,
    AiConsultationGateway,
    GroqKeyPool,
    GroqKeyRepository,
    GroqKeysService,
    { provide: GROQ_KEY_STORE, useExisting: GroqKeysService },
  ],
  exports: [
    TypeOrmModule,
    AiChatsService,
    AiConsultationService,
    GroqKeyPool,
    GroqKeysService,
  ],
})
export class AiModule {}
