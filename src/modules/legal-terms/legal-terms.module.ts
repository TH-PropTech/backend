import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { LegalTermsDocument } from './schemas/legal-terms-document.schema'
import { LegalTermsService } from './legal-terms.service'
import { LegalTermsController } from './legal-terms.controller'

@Module({
  imports: [TypeOrmModule.forFeature([LegalTermsDocument])],
  controllers: [LegalTermsController],
  providers: [LegalTermsService],
  exports: [LegalTermsService],
})
export class LegalTermsModule {}
