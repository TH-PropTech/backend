import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LegalSource } from './schemas/legal-source.schema'
import { PlatformRegulation } from './schemas/platform-regulation.schema'
import { LegalSourcesService } from './legal-sources.service'
import { PlatformRegulationsService } from './platform-regulations.service'
import { LegalSourcesController } from './legal-sources.controller'
import { PlatformRegulationsController } from './platform-regulations.controller'

@Module({
  imports: [TypeOrmModule.forFeature([LegalSource, PlatformRegulation])],
  controllers: [LegalSourcesController, PlatformRegulationsController],
  providers: [LegalSourcesService, PlatformRegulationsService],
})
export class LegalSourcesModule {}
