import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { SmartCaSigningSession } from './schemas/smartca-signing-session.schema'
import { SmartCaProvider } from './providers/smartca.provider'
import { MockSmartCaProvider } from './providers/mock-smartca.provider'
import { SmartCaEventsGateway } from './gateways/smartca-events.gateway'
import { SMARTCA_EVENTS_PUBLISHER } from './gateways/smartca-events.publisher'

/**
 * Adapter lá cho ký số SmartCA: không phụ thuộc module domain (contracts import một chiều vào đây).
 * Export TypeOrmModule để module domain inject được repository của SmartCaSigningSession.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SmartCaSigningSession])],
  providers: [
    MockSmartCaProvider,
    {
      provide: SmartCaProvider,
      inject: [ConfigService, MockSmartCaProvider],
      useFactory: (
        cfg: ConfigService,
        mock: MockSmartCaProvider
      ): SmartCaProvider | MockSmartCaProvider => {
        const isMock = cfg.get<{ isMock?: boolean }>('smartCA')?.isMock
        return isMock ? mock : new SmartCaProvider(cfg)
      },
    },
    SmartCaEventsGateway,
    {
      provide: SMARTCA_EVENTS_PUBLISHER,
      useExisting: SmartCaEventsGateway,
    },
  ],
  exports: [
    TypeOrmModule,
    MockSmartCaProvider,
    SmartCaProvider,
    SmartCaEventsGateway,
    SMARTCA_EVENTS_PUBLISHER,
  ],
})
export class DigitalSignatureModule {}
